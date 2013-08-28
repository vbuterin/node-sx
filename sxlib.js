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
            //console.log('e',err,'f',fail,'s',success);
            if (fail) { fail(err); }
        }
        else {
            success(res);
        }
    };
};

// Splits text into JSON objects, using zero indent as the splitter
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

m.cbuntil = function(f,cb) {
    f(eh(cb,function(res) {
        if (!res) { m.cbuntil(f,cb) }
        else cb(null,res);
    }));
}

m.cbmap = function(array,f,cb) {
    var cbs = array.length;
    var out = Array(array.length);
    var done = _.once(cb);
    if (array.length === 0) { return cb(null,[]); }
    for (var i = 0; i < array.length; i++) {
        f(array[i],function(ii) { return eh(done,function(v) {
            out[ii] = v;
            cbs--;
            if (cbs===0) { return done(null,out); }
        }); }(i));
    };
}

m.cbmap_seq = function(array,f,cb) {
    var out = Array(array.length);
    var inner = function(i) {
        if (i >= array.length) { return cb(null,out); }
        f(array[i],function(ii) { return eh(cb,function(v) {
            out[ii] = v;
            inner(i+1);
        }); }(i));
    };
    inner(0);
}

m.foldr = function(array,init,f,cb) {
    var inner = function(o,i) {
        if (i == array.length) { return cb(null,o); }
        f(o,array[i],eh(cb,function(out) { inner(out,i+1); }));
    };
    inner(init,0);
}


var cmdcall = function(arg,args,inp,cb) {
    if (!args) args = [];
    var p = spawn("sx",[arg].concat(args));
    if (inp) { 
        //console.log('inp',inp,'arg',arg);
        p.stdin.write(inp); 
    }
    p.stdin.on('error',function(e) { console.log(e); });
    p.stdin.end();
    var data = "";
    p.stdout.on('data',function(d) { data += d; });
    p.stdout.on('close',function() { cb(null,strip(data)); });
    p.stdout.on('error',cb);
    p.on('error',function(e) { console.log(e); });
}

m.newkey = _.partial(cmdcall,'newkey',null,null);
m.pubkey = _.partial(cmdcall,'pubkey',null);
m.addr = _.partial(cmdcall,'addr',null);
m.decode_addr = _.partial(cmdcall,'decode-addr',null);
m.newseed = _.partial(cmdcall,'newseed',null,null);
m.mpk = _.partial(cmdcall,'mpk',null);
m.mnemonic = _.partial(cmdcall,'mnemonic',null);
m.btc = _.partial(cmdcall,'btc',null);
m.satoshi = _.partial(cmdcall,'satoshi',null);

m.genpriv = function(seed,count,bit,cb) {
    bit = bit ? 1 : 0;
    cmdcall('genpriv',[count,bit],seed,cb);
}
m.genaddr = function(seed,count,bit,cb) {
    bit = bit ? 1 : 0;
    cmdcall('genaddr',[count,bit],seed,cb);
}
m.qrcode = function(data,cb) {
    var filename = '/tmp/sxnode-qr' + (""+Math.random()).substring(2,11) + ".png";
    cmdcall('qrcode',[data,filename],null,eh(cb,_.partial(cb,null,filename)));
}

m.balance = _.partial(cmdcall,'balance',null);
m.fetch_transaction = _.partial(cmdcall,'fetch-transaction',null);
m.fetch_last_height = _.partial(cmdcall,'fetch-last-height',null,null);
m.bci_fetch_last_height = _.partial(cmdcall,'bci-fetch-last-height',null,null);

m.history = function(addrs,cb) {
    if (typeof addrs === "string") { addrs = [addrs]; }
    var process_history = _.once(function(history,height) {
        var json = m.jsonfy(history);
        var postprocess = function(obj) {
            return {
                address: obj.Address,
                spend: (obj.spend == "Unspent") ? null : obj.spend,
                value: parseInt(obj.value),
                output: obj.output
            }
        }
        cb(null,json.map(postprocess));
    });
    m.fetch_last_height(eh(cb,function(height) {
        cmdcall('history',addrs,null,eh(cb,function(history) {
            process_history(history,height);
        }));
    }));
    /*m.bci_fetch_last_height(eh(cb,function(height) {
        cmdcall('bci-history',addrs,null,eh(cb,function(history) {
            console.log('bh',addrs,history);
            process_history(history,height);
        }));
    }));*/
}

m.scripthash = _.partial(cmdcall,'scripthash',null);
m.rawscript = function(inp,cb) { cmdcall('rawscript',inp,null,cb); }
m.showscript = function(inp,cb) { 
    cmdcall('showscript',null,inp,eh(cb,function(s) { cb(null,strip(s).split(' ')); }));
}

var txop = function(arg, args, output_tx, tx, inp, cb) {
    var filename = '/tmp/sxnode-' + (""+Math.random()).substring(2,11);
    fs.writeFile(filename,tx || "",eh(cb,function() {
        args = [filename].concat(args || []);
        //console.log('fn',filename,'args',args,'a',arguments);
        var p = spawn("sx",[arg].concat(args));
        if (inp) { 
            p.stdin.write(inp); 
        }
        p.stdin.end();
        var data = "";
        p.stdout.on('data',function(d) { data += d; });
        p.stdout.on('close',function() { 
            if (output_tx) { 
                fs.readFile(filename,eh(cb,function(tx) { cb(null,""+tx); }));
            }
            else { cb(null,strip(data)); }
        });
        p.stdout.on('error',cb);
    }));
}

m.mktx = function(inputs, outputs, cb) {
    var args = inputs.map(function(x) { 
        if (x.output) { return " -i "+x.output; }
        else return " -i "+x;
    });
    args = args.concat(outputs.map(function(x) {
        return " -o "+ x.address + ":" + x.value;
    }));
    txop('mktx',args,true,null,null,cb);
}

m.showtx = function(tx,cb) { 
    txop("showtx",null,false,tx,null,eh(cb,function(shown) {
        try {
            var ans = {
                inputs: [],
                outputs: []
            };
            m.jsonfy(shown).map(function(o) {
                if (o.Input != undefined) {
                    ans.inputs.push({
                        prev: o["previous output"],
                        script: o.script.split(' '),
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
            if (shown.inputs[inp].script.length == 6) {
                var pub = shown.inputs[inp].script[4];
                if (len(pub) == 66 || len(pub) == 130) { return cb(null,pub); }
                return cb("Failed to parse script: "+shown.inputs[inp].script);
            }
            else { m.rawscript(shown.inputs[inp].script,cb); }
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

m.validtx = function(tx,cb) { txop("validtx",[],false,tx,null,cb); }

m.broadcast = m.broadcast_tx = function(tx,cb) {
    async.waterfall([function(cb2) {
        var filename = '/tmp/sxnode-' + (""+Math.random()).substring(2,11);
        fs.writeFile(filename,tx || "",eh(cb,function() { cb2(null,filename); }));
    }, function(filename,cb2) {
        var p = spawn("sx",['broadcast-tx',filename]);
        p.stdin.end();
        var data = "";
        var count = 0;
        p.stdout.on('data',function(d) { 
            data += d; count++; console.log(""+d);
            if (count >= 25) { return cb2(null,data); }
        });
        p.stdout.on('close',function() { cb2(null,data); });
        p.stdout.on('error',cb);
    }],cb);
}

m.bci_pushtx = function(tx,cb) { txop("bci-pushtx",null,false,tx,null,cb); }

m.get_enough_utxo_from_history = function(h,amount,cb) {
    var utxo = h.filter(function(x) { return !x.spend });
    var valuecompare = function(a,b) { return a.value > b.value; }
    var high = utxo.filter(function(o) { return o.value >= amount; }).sort(valuecompare);
    if (high.length > 0) { return cb(null,[high[0]]); }
    utxo.sort(valuecompare);
    var totalval = 0;
    for (var i = 0; i < utxo.length; i++) {
        totalval += utxo[i].value;
        if (totalval >= amount) { return cb(null,utxo.slice(0,i+1)); }
    }
    return cb({ err: "Not enough money", value: totalval, needed: amount});
}

// Gets UTXO set paying value _value_ from address set _[from]_
m.get_utxo = function(from, value, cb) {
    if (typeof from == "string") from = [from];
    m.history(from,eh(cb,function(h) {
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

m.txhash = function(tx,cb) {
    m.showtx(tx,eh(cb,function(shown) { cb(null,shown.hash); }));
}

// Converts a pk or list of pks to an addrdata object
// addrdata: { priv: _, pub: _, address: _, hash160: _, raw: _ }
m.gen_addr_data = function(pk,cb) {
    if (_.isArray(pk)) { //Handles arrays of private keys
        return m.cbmap(pk,m.gen_addr_data,cb);
    }
    if (typeof pk == "object") { return cb(null,pk); }

    var addrdata = { priv: pk }

    var adpusher = function(key,cb2) { 
        return eh(cb2,function(val) {
            addrdata[key] = val; cb2();
        }); 
    }
    async.waterfall([
        function(cb2) { m.pubkey(addrdata.priv,adpusher('pub',cb2)) },
        function(cb2) { m.addr(addrdata.priv,adpusher('address',cb2)) },
        function(cb2) { m.decode_addr(addrdata.address,adpusher('hash160',cb2)) },
        function(cb2) {
            if (addrdata.address[0] == '1') {
                var script = ['dup','hash160','[',addrdata.hash160,']','equalverify','checksig'];
                addrdata.script = script;
                m.rawscript(script, adpusher('raw',cb2));
            }
            else cb2();
        },
    ],eh(cb,function() { cb(null,addrdata); }));
}

// Generates a multisig address and its associated script
m.gen_multisig_addr_data = function(pubs,k,cb) {
    m.cbmap(pubs,function(addrdata,cb2) {
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
        var zeroes = [].concat(_.range(sigs.length,n).map(function() { return 'zero' }));
        var script2 = [].concat.apply(zeroes,sigs.map(function(sig) { return ['[',sig,']']; }))
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
            m.foldr(_.range(shown.inputs.length),tx,function(tx,i,cb2) {
                var good_addrdata = addrdata.filter(function(x) {
                    return utxomap[shown.inputs[i].prev] &&
                           x.address == utxomap[shown.inputs[i].prev].address;
                });
                if (good_addrdata.length === 0) { return cb2(null,tx); }
                else m.sign_tx_input(tx,i,good_addrdata[0],cb2);
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
