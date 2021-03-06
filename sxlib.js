var cp = require('child_process'),
    exec = cp.exec,
    spawn = cp.spawn,
    _ = require('underscore'),
    fs = require('fs'),
    async = require('async');

//require('long-stack-traces');

var m = {};

var strip = function(s) { return s.replace(/^\s+|\s+$/g, '') }
var identity = function(x) { return x; }

m.deepclone = function(obj) {
    if (_.isArray(obj)) {
        return obj.map(function(x) { return m.deepclone(x); });
    }
    else if (typeof obj == "object" && obj != null) {
        var o = {}
        for (var v in obj) { o[v] = m.deepclone(obj[v]); }
        return o;
    }
    else { return obj; }
}

var eh = m.eh = function(fail, success) {
    return function(err, res) {
        if (err) {
            console.log('e',err,'f',fail,'s',success);
            if (fail) { fail(err); }
        }
        else {
            success.apply(this,Array.prototype.slice.call(arguments,1));
        }
    };
};

// Splits text into JSON objects, using zero indent as the splitter
// Example:
//
// Bob: 123
//   Joe: 78782
//   Fred: 111
// Wilson: 540   
//   Ashley: 0
// -> 
// [
//   { Bob: 123, Joe: 78782, Fred: 111 },
//   { Wilson: 540, Ashley: 0 }
// ]
m.jsonfy = function(txt) {
    var lines = txt.split('\n').filter(identity).map(function(x) {
        return {
            indent: RegExp('^\ *').exec(x)[0].length,
            key: strip(x.substring(0,x.indexOf(':'))),
            val: strip(x.substring(x.indexOf(':')+1))
        }
    });
    var out = [],
        cur = {};
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indent == 0) {
            if (!_.isEmpty(cur)) { out.push(cur); }
            cur = {};
        }
        cur[lines[i].key] = lines[i].val;
    }
    if (!_.isEmpty(cur)) { out.push(cur); }
    return out;
}

m.noop = function(){};

m.getter = function(p) { return function(x) { return x[p] } }

m.cbgetter = function(p,cb) { 
    return eh(cb,function(x) { cb(null,x[p]) }); 
}

m.setter = function(o,p,cb) { 
    return function(x) { o[p] = x; if (cb) cb(); return x; } 
}

m.cbsetter = function(o,p,cb) { 
    return m.eh(cb,function(x) { o[p] = x; cb(null,x); }); 
}
m.plus = function(x,y) { return x+y }

m.add = function() {
    return Array.prototype.reduce.call(arguments,m.plus,0);
}

m.cbuntil = function(f,cb) {
    f(eh(cb,function(res) {
        if (!res) { m.cbuntil(f,cb) }
        else cb(null,res);
    }));
}

m.resjson = function(res,code,debug) {
    if (!code) code = 404;
    return function(err,response) {
        if (debug) console.log(err || response);
        return err ? res.json(err,code) : res.json(response);
    }
}

m.smartParse = function(x) {
    if (typeof x == "string" && x[0] == '"' && x[x.length-1] == '"') {
        return JSON.parse(x);
    }
    else return x;
}

m.txouniq = function(arr) { return _.uniq(arr,false,function(x) { return x.output; }); }
m.txodiff = function(arr1,arr2) {
    var del_outputs = arr2.map(function(x) { return x.output });
    return arr1.filter(function(x) { return del_outputs.indexOf(x.output) == -1 });
}

m.is_base58 = function(data) {
    return !!RegExp('^[0-9A-Za-z]*$').exec(data) && !m.is_hex(data);
}
m.is_hex = function(data) {
    return !!RegExp('^[0-9a-fA-F]*$').exec(data);
}

m.is_pubkey = function(data) {
    return m.is_hex(data) && (data.length == 66 || data.length == 130) &&
        ['02','03','04'].indexOf(data.substring(0,2)) >= 0;
}
m.is_sig = function(data) {
    return m.is_hex(data) && ['304'].indexOf(data.substring(0,3)) >= 0;
}

m.is_script = function(data) {
    return m.is_hex(data) && !m.is_hex_privkey(data) && !m.is_pubkey(data);
}

m.is_wif_privkey = function(x) {
    return m.is_base58(x) && 40 <= x.length && x.length <= 60;
}

m.is_hex_privkey = function(x) {
    return m.is_hex(x) && x.length == 64;
}

m.is_addr = function(x) {
    return m.is_base58(x) && 20 <= x.length <= 34 && (x[0] == '1' || x[0] == '3');
}

var sanitize = function(x) { return (x+"").replace(/[^A-Za-z0-9\-\/:\[\]]/g,'') }

var call = function(cmd,args,inp,cb) {
    var p = spawn(cmd,args);
    if (inp) { 
        p.stdin.write(inp); 
    }
    p.stdin.on('error',function(e) { console.log(e); });
    p.stdin.end();
    var data = "",
        error = "";
    p.stdout.on('data',function(d) { data += d; });
    p.stderr.on('data',function(d) { error += d; });
    var argz = arguments;
    cb = cb || m.noop;
    p.on('exit',function(exitcode) {
        if (exitcode == 0) { cb(null,strip(data)); }
        else { console.log(strip(error)); cb(strip(error)); }
    });
    p.on('error',function(e) { console.log(e); cb(e); });
}

var cmdcall = function(sxcmd,args,inp,cb) {
    args = (args || []).map(sanitize)
    return call("sx",[sanitize(sxcmd)].concat(args),inp,cb);
}

m.newkey = _.partial(cmdcall,'newkey',null,null);
m.pubkey = function(priv,cb) {
    if (m.is_hex_privkey(priv)) {
        return m.base58check_encode(priv,128,eh(cb,function(wif) {
            cmdcall('pubkey',null,wif,cb);
        }));
    }
    else cmdcall('pubkey',null,priv,cb);
}
// Pubkeys and wif privkeys only
m.addr = _.partial(cmdcall,'addr',null);
// Universal
m.toaddress = function(input,cb) {
    if (m.is_pubkey(input) && m.is_wif_privkey(input)){
        m.addr(input, cb);
    }
    else if (m.is_hex_privkey(input)) {
        m.base58_encode(input,128,eh(cb,function(wif) {
            m.addr(wif, cb);
        }));
    }
    else if (m.is_script(input)) {
        m.scripthash(input, cb);
    }
    else if (m.is_addr(input)) {
        cb(null, input);
    }
    else cb("Weird input: "+input, 400);
}
m.decode_addr = _.partial(cmdcall,'decode-addr',null);
m.newseed = _.partial(cmdcall,'newseed',null,null);
m.mpk = _.partial(cmdcall,'mpk',null);
m.mnemonic = _.partial(cmdcall,'mnemonic',null);
m.btc = _.partial(cmdcall,'btc',null);
m.satoshi = _.partial(cmdcall,'satoshi',null);
m.base58check_encode = function(hexstr,vb,cb) { 
    return cmdcall('base58check-encode',[hexstr,vb],null,cb);
}
m.base58check_decode = _.partial(cmdcall,'base58check-decode',null)

var gens = ['genpriv','genpub','genaddr']
gens.map(function(cmd) {
    m[cmd] = function(seed,count,bit,cb) {
        bit = bit ? 1 : 0;
        cmdcall(cmd,[count,bit],seed,cb);
    }
});

m.qrcode = function(data,cb) {
    var filename = '/tmp/sxnode-qr' + (""+Math.random()).substring(2,11) + ".png";
    cmdcall('qrcode',[data,filename],null,eh(cb,_.partial(cb,null,filename)));
}

m.balance = _.partial(cmdcall,'balance',null);
m.fetch_transaction = _.partial(cmdcall,'fetch-transaction',null);
m.blke_fetch_transaction = function(tx,cb) {
    cmdcall('blke-fetch-transaction',[tx],null,cb)
}
m.fetch_last_height = _.partial(cmdcall,'fetch-last-height',null,null);
m.bci_fetch_last_height = _.partial(cmdcall,'bci-fetch-last-height',null,null);
m.brainwallet = function(user,pass,algo,cb) {
    var args = [user]
    if (pass) args.push(pass)
    if (algo) args = args.concat(['--algo',algo])
    cmdcall('brainwallet',args,null,eh(cb,function(priv) {
        m.gen_addr_data(priv,cb);
    }));
}

m.get_history = function(blkfetch,histfetch,addrs,cb) {
    if (typeof addrs === "string") { addrs = [addrs]; }
    var process_final = _.once(function(height,history) {
        if (!history) {
            return cb(null,[]);
        }
        var json = m.jsonfy(history);
        var postprocess = function(obj) {
            return {
                address: obj.Address,
                spend: (obj.spend == "Unspent") ? null : obj.spend,
                value: parseInt(obj.value),
                output: obj.output,
                confirmations: (obj.output_height == "Pending") 
                    ? 0
                    : height - parseInt(obj.output_height)
            }
        }
        cb(null,json.map(postprocess));
    });
    blkfetch(eh(cb,function(height) {
        histfetch(addrs,eh(cb,function(history) {
            process_final(height,history);
        }));
    }));
}
m.raw_sx_history = function(addrs,cb) { cmdcall('history',addrs,null,cb); }
m.raw_bci_history = function(addrs,cb) { cmdcall('bci-history',addrs,null,cb); }

m.history = _.partial(m.get_history,m.fetch_last_height,m.raw_sx_history);
m.bci_history = _.partial(m.get_history,m.bci_fetch_last_height,m.raw_bci_history);

m.scripthash = _.partial(cmdcall,'scripthash',null);
m.rawscript = function(inp,cb) { cmdcall('rawscript',inp,null,cb); }
m.showscript = function(inp,cb) { 
    cmdcall('showscript',null,inp,eh(cb,function(s) { cb(null,strip(s).split(' ')); }));
}

var txop = function(cmd, args, output_tx, tx, inp, cb) {
    var filename = '/tmp/sxnode-' + (""+Math.random()).substring(2,11);
    fs.writeFile(filename,tx || "",eh(cb,function() {
        cmdcall(cmd,[filename].concat(args || []),inp,eh(cb,function(stdout) {
            if (output_tx) { 
                fs.readFile(filename,eh(cb,function(tx) { cb(null,""+tx); }));
            }
            else { cb(null,stdout); }
        }));
    }));
}

m.mktx = function(inputs, outputs, cb) {
    var args = [];
    inputs.map(function(x) { 
        args = args.concat(["-i",x.output ? x.output : x]);
    });
    outputs.map(function(x) {
        args = args.concat(["-o",x.address + ":" + x.value]);
    });
    txop('mktx',args,true,null,null,cb);
}

m.showtx = function(tx,cb) { 
    txop("showtx",null,false,tx,null,eh(cb,function(shown) {
        try {
            var ans = {
                inputs: [],
                outputs: [],
                hex: tx
            };
            m.jsonfy(shown).map(function(o) {
                if (o.Input != undefined) {
                    ans.inputs.push({
                        prev: o["previous output"],
                        script: o.script ? o.script.split(' ') : null,
                        address: (27 < (o.address || "").length <= 34) ? o.address : null,
                        sequence: o.sequence
                    });
                }
                else if (o.Output != undefined) {
                    ans.outputs.push({
                        script: o.script.split(' '),
                        value: parseInt(o.value),
                        address: (27 < (o.address || "").length <= 34) ? o.address : null,
                        output: ans.hash + ":" + ans.outputs.length
                    });
                }
                else {
                    for (var v in o) { ans[v] = o[v]; }
                }
            });
            cb(null,ans);
        } catch(e) { cb(e); }
    }));
}

m.extract_pubkey_or_script_from_txin = function(txin,cb) {
    m.fetch_transaction(txin.substring(0,64),eh(cb,function(tx) {
        m.showtx(tx,eh(cb,function(shown) {
            var inp = parseInt(txin.substring(65));
            var txinobj = shown.inputs[inp];
            if (!txinobj) {
                return cb("Transaction input does not exist"); 
            }
            else if (txinobj.script.length == 6) {
                var pub = shown.inputs[inp].script[4];
                if (pub.length == 66 || pub.length == 130) { return cb(null,pub); }
                return cb("Failed to parse script: "+shown.inputs[inp].script);
            }
            else {
                return cb(null,txinobj.script[txinobj.script.length-2]);
            }
        }));
    }));
}

m.addr_to_pubkey = m.address_to_pubkey = function(address,cb) {
    m.history(address,eh(cb,function(h) {
        var stxo = h.filter(function(o) { return o.spend });
        if (!stxo.length) {
            return cb("No spends from this address"); 
        }
        m.extract_pubkey_or_script_from_txin(stxo[0].spend,cb);
    }));
}

m.sign_input = function(tx,index,script,key,cb) { txop("sign-input",[index,script],false,tx,key,cb); }

m.validate_input = function(tx,index,script,sig,pubkey,cb) { 
    txop("validsig",[index,script,sig],false,tx,pubkey,eh(cb,function(out) {
        console.log('validating: ',tx,index,script,sig,pubkey,out);
        cb(null,out.indexOf("OK") >= 0);
    }));
}

m.set_input = function(tx,index,inp,cb) { txop("set-input",[index],false,tx,inp,cb); }

m.validtx = function(tx,cb) { 
    txop("validtx",[],false,tx,null,eh(cb,function(r) {
        try { cb(null,m.jsonfy(r)[0].Status); }
        catch(e) { cb(e) }
    }));
}

m.broadcast = m.broadcast_tx = function(tx,cb) {
    async.waterfall([function(cb2) {
        m.validtx(tx,eh(cb2,function(r) {
            var result = m.jsonfy(r)[0].Status;
            if (result != "Success") return cb2(result);
            cb2();
        }));
    }, _.partial(m.txhash,tx)
    , function(hash,cb2) {
        var filename = '/tmp/sxnode-' + (""+Math.random()).substring(2,11);
        fs.writeFile(filename,tx || "",eh(cb,function() { cb2(null,hash,filename); }));
    }, function(hash,filename,cb2) {
        var p = spawn("sx",['broadcast-tx',filename]);
        p.stdin.end();
        p.stdout.on('close',function() {
            cb2("Status unknown, submission may have failed"); 
        });
        p.stdout.on('error',cb);
        return cb2(null,hash)
    }],eh(cb,function(hash) { return cb(null,hash) }));
}

m.bci_pushtx = function(tx,cb) { 
    txop("bci-pushtx",null,false,tx,null,eh(cb,function(r) {
        try {
            if (r == "Transaction Submitted") {
                m.txhash(tx,eh(cb,function(hash) {
                    cb(null,hash);
                }));
            }
            else cb(r);
        }
        catch(e) { cb(e) }
    }));
}

m.electrum_pushtx = function(tx,cb) {
   console.log(tx);
   call("electrum",["sendrawtransaction",tx],null,cb); 
}

m.get_enough_utxo_from_history = function(h,amount,cb) {
    var utxo = h.filter(function(x) { return !x.spend });
    var priority = function(o) {
        // If one output can pay for the entire transaction, prioritize it
        if (o.value >= amount) return [0,o.value];
        // Otherwise, try to use as few outputs as possible (ie. the largest
        // outputs) to make the transaction. This also fights against
        // "satoshi pollution" attacks
        else return [1,-o.value]
    }
    var valuecompare = function(a,b) { return priority(a) > priority(b) }
    utxo = utxo.sort(valuecompare);
    var totalval = 0;
    for (var i = 0; i < utxo.length; i++) {
        totalval += utxo[i].value;
        if (totalval >= amount) { return cb(null,utxo.slice(0,i+1)); }
    }
    return cb("Not enough funds to construct transaction outputs. Have: "+totalval+" satoshis, needed: "+amount);
}

// Gets UTXO set paying value _value_ from address set _[from]_
m.get_utxo = function(from, value, cb) {
    if (typeof from == "string") from = [from];
    m.bci_history(from,eh(cb,function(h) {
        m.get_enough_utxo_from_history(h,value,cb);
    }));
}

// Makes a sending transaction paying _value_ from UTXO set _[utxo]_ to address _to_
// sending change to _[change]_
m.make_sending_transaction = function(utxo, to, value, change, cb) {
    var sum = utxo.map(function(x) { return x.value; })
        .reduce(function(a,b) { return a+b; },0);
    var outputs = [{
        address: to,   
        value: value
    }]
    if (value < 5430) { return cb("Amount below dust threshold!"); }
    if (sum < value) { return cb("Not enough money!"); }
    if (sum-value < 10000) { return cb("Not enough to pay 0.0001 BTC fee!"); }

    // Split change in half by default so that the wallet has multiple UTXO at all times
    if (typeof change == "string") change = [change, change];

    var changelen = Math.min(change.length,Math.floor((sum-value-10000) / 5430));

    for (var i = 0; i < changelen; i++) {
        outputs.push({ 
            address: change[i],
            value: Math.floor((sum-value-10000)/changelen) 
        });
    }
    m.mktx(utxo,outputs,cb);
}

// Fix a set of outputs, and make a transaction to send to it 
// picking inputs from a history. excessIndex specified which
// output to send excess funds to
m.send_to_outputs = function(history,outputs,excessIndex,cb) {
    var fee_multiplier = 1,
        fee,
        out_value = outputs.map(m.getter('value')).reduce(m.plus,0);
    m.cbuntil(function(cb2) {
        fee = fee_multiplier * 10000;
        m.get_enough_utxo_from_history(history,out_value + fee,eh(cb2,function(utxo) {
            m.mktx(utxo,outputs,eh(cb2,function(tx) {
                if (Math.ceil((tx.length + 2) / 2048) > fee_multiplier) {
                    console.log(fee_multiplier);
                    fee_multiplier = Math.ceil(tx.length / 2048);
                    return cb2(null,false);
                }
                return cb2(null,{ tx: tx, utxo: utxo });
            }));
        }));
    },eh(cb,function(o) {
        var in_value = o.utxo.map(m.getter('value')).reduce(m.plus,0);
        var outs = outputs.map(_.clone);
        outs[excessIndex].value += in_value - out_value - fee;
        m.mktx(o.utxo,outs,eh(cb,function(tx) {
            return cb(null,{ tx: tx, utxo: o.utxo })
        }));
    }));
}


m.txhash = function(tx,cb) {
    m.showtx(tx,eh(cb,function(shown) { cb(null,shown.hash); }));
}

// Converts a pk or list of pks to an addrdata object
// addrdata: { priv: _, pub: _, address: _, hash160: _, raw: _ }
m.gen_addr_data = function(pk,cb) {
    if (_.isArray(pk)) { //Handles arrays of private keys
        return async.map(pk,m.gen_addr_data,cb);
    }
    if (typeof pk == "object") { return cb(null,pk); }

    var d = { priv: pk }

    async.waterfall([
        function(cb2) { m.pubkey(d.priv,m.cbsetter(d,'pub',cb2)) },
        function(_,cb2) { m.addr(d.priv,m.cbsetter(d,'address',cb2)) },
        function(_,cb2) { m.decode_addr(d.address,m.cbsetter(d,'hash160',cb2)) },
        function(_,cb2) {
            if (d.address[0] == '1') {
                var script = ['dup','hash160','[',d.hash160,']','equalverify','checksig'];
                d.script = script;
                m.rawscript(script, m.cbsetter(d,'raw',cb2));
            }
            else cb2();
        },
    ],eh(cb,function() { cb(null,d); }));
}

// Generates a multisig address and its associated script
m.gen_multisig_addr_data = function(pubs,k,cb) {
    async.map(pubs,function(addrdata,cb2) {
        if (typeof addrdata == "object") { 
            return cb2(null,addrdata.pub);
        }
        addrdata = strip(addrdata);
        if (addrdata.length == 66 || addrdata.length == 130) {
            cb2(null,addrdata);
        }
        else if (addrdata.length > 35 && addrdata.length < 66) {
            m.pubkey(addrdata,cb2);
        }
        else {
            console.log("Address given. Attempting to find pubkey in blockchain");
            m.addr_to_pubkey(addrdata,cb2);
        }
    },eh(cb,function(unsorted_results) {
        // By convention, sort by pubkey
        var results = unsorted_results.sort(function(a,b) { return a>b });
        var script = results.reduce(function(arr,pub) { return arr.concat(['[',pub,']']) },[k])
                            .concat([results.length,'checkmultisig']);
        m.rawscript(script,eh(cb,function(raw) {
            m.scripthash(raw,eh(cb,function(address) {
                cb(null,{ raw: raw, script: script, pubs: results, address: address, n: results.length, k: k });
            }));
        }));
    }));
}

// Signs a transaction at index _index_ with the _addrdata_ object or a private key
m.sign_tx_input = function(tx,index,addrdata,cb) {
    if (typeof addrdata == "string") {
        return m.gen_addr_data(addrdata,eh(cb,function(res) {
            m.sign_tx_input(tx,index,res,cb);
        }));
    }
    if (!addrdata.raw) { return cb("Malformed addrdata object or multisig address"); }
    m.sign_input(tx,index,addrdata.raw,addrdata.priv,eh(cb,function(sig) {
        var script = ['[',sig,']','[',addrdata.pub,']'];
        m.rawscript(script,eh(cb,function(raw2) {
            m.set_input(tx,index,raw2,eh(cb,function(tx) {
                cb(null,tx);
            }));
        }));
    }));
}

//Apply signatures to a multisig output
m.apply_multisignatures_at_index = function(tx,script,index,sigobj,cb) {
    m.showscript(script,eh(cb,function(sc) {
        var n = parseInt(sc[sc.length-2]),
            k = parseInt(sc[0]),
            sigs = (sigobj || []).filter(function(x) { return x; });
        //console.log('attempt',n,k,sigs,sigs.length);
        if (sigs.length < k) {
            return cb(null,tx);
        }
        var script2 = [].concat.apply(['zero'],sigs.map(function(sig) { return ['[',sig,']']; }))
            .concat(['[',script,']']);
        m.rawscript(script2,eh(cb,function(r) {
            m.set_input(tx,index,r,cb);
        }));
    }));
}

m.multisig_sign_tx_input = m.sign_input;

// Sign all singlesig inputs signable with _[privs]_, using _[utxo]_ to get data of which
// priv applies where
m.sign_tx_inputs = function(tx, privs, utxo, cb) {
    if (typeof privs === "string") { privs = [privs]; }
    m.gen_addr_data(privs,eh(cb,function(addrdata) {
        m.showtx(tx,eh(cb,function(shown) {
            var utxomap = {};
            utxo.map(function(u) { utxomap[u.output] = u; });
            async.foldl(_.range(shown.inputs.length),tx,function(tx,i,cb2) {
                var good_addrdata = addrdata.filter(function(x) {
                    return utxomap[shown.inputs[i].prev] &&
                           x.address == utxomap[shown.inputs[i].prev].address;
                });
                if (good_addrdata.length === 0) { 
                    return cb2(null,tx); 
                }
                else { 
                    m.sign_tx_input(tx,i,good_addrdata[0],cb2); 
                }
            },cb);
        }));
    }));
}

// Send _value_ money from the wallet of _[pks]_ to _to_, sending change to _[change]_
m.send = function(pks, to, value, change, cb) {
    if (typeof pks === "string") {
        pks = [pks];
    }
    async.waterfall( [
        function(cb2) { m.gen_addr_data(pks,cb2); },
        function(addrdata,cb2) { 
            var addrs = addrdata.map(function(x) { return x.address; });
            m.get_utxo(addrs, value, eh(cb,function(utxo) {
                m.make_sending_transaction(utxo, to, value, change, eh(cb,function(tx) {
                    cb2(null,tx,addrdata,utxo)
                }));
            }));
        },
        m.sign_tx_inputs,
        function(tx,cb2) {
            m.txhash(tx,eh(cb,function(hash) {
                m.broadcast(tx,function() { cb(null, {tx: tx, hash: hash}); });
            }));
    }],cb);
}

module.exports = m;
