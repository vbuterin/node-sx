var Db = require('mongodb').Db;
var Connection = require('mongodb').Connection;
var Server = require('mongodb').Server;
var BSON = require('mongodb').BSON;
var ObjectID = require('mongodb').ObjectID;
var cp = require('child_process'),
    express = require('express'),
    exec = cp.exec,
    spawn = cp.spawn,
    _ = require('underscore'),
    fs = require('fs'),
    async = require('async');
    crypto = require('crypto'),
    sha256 = function(x) { return crypto.createHash('sha256').update(x).digest('hex') };

//require('long-stack-traces');

var m = {};

var strip = function(s) { return s.replace(/^\s+|\s+$/g, '') }
var identity = function(x) { return x; }

var eh = m.errHandle = function(fail, success) {
    return function(err, res) {
        if (err) {
            //console.log('e',err,'f',fail,'s',success);
            fail(err);
        }
        else {
            success(res);
        }
    };
};

m.cbuntil = function(f,cb) {
    f(eh(cb,function(res) {
        if (!res) { m.cbuntil(f,cb) }
        else cb(null,res);
    }));
}

m.cbmap = function(array,f,cb) {
    var cbs = array.length;
    var out = Array(array.length);
    var cbcalled = false;
    if (array.length === 0) { return cb(null,[]); }
    for (var i = 0; i < array.length; i++) {
        f(array[i],function(ii) { return eh(function(err) {
            if (!cbcalled) { cb(err); cbcalled = true; }
        },function(v) {
            out[ii] = v;
            cbs--;
            if (cbs===0) { return cb(null,out); }
        }); }(i));
    };
}

m.cbmap_seq = function(array,f,cb) {
    var out = Array(array.length);
    var inner = function(i) {
        f(array[i],function(ii) { return eh(cb,function(v) {
            out[ii] = v;
            if (ii == array.length-1) { return cb(null,out); }
            else inner(i+1);
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
    p.stdin.end();
    var data = "";
    p.stdout.on('data',function(d) { data += d; });
    p.stdout.on('close',function() { cb(null,strip(data)); });
    p.stdout.on('error',cb);
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
m.fetch_last_height = _.partial(cmdcall,'fetch-last-height',null);
m.history = function(addrs,cb) {
    if (typeof addrs === "string") { addrs = [addrs]; }
    cmdcall('fetch-last-height',null,null,eh(cb,function(height) {                    
        m.cbmap(addrs,function(addr,cb2) {
            cmdcall('history',[addr],null,cb2);
        },eh(cb,function(histories) {
            var htext = histories.join('\n');
            var data = [];
            var cur = {};
            var lines = htext.split('\n').map(strip);
            for (var i = 0; i < lines.length; i++) {
                var fields = lines[i].split(' ').filter(identity);
                if (fields[0] == "Address:") cur = { address: fields[1] };
                if (fields[0] == "output:") {
                    cur.output = fields[1];
                    if (fields[2] == "Pending") cur.confirmations = 0;
                    else cur.confirmations = height - parseInt(fields[3]) + 1;
                }
                if (fields[0] == "value:") cur.value = parseInt(fields[1]);
                if (fields[0] == "spend:") {
                    cur.spend = fields[1] == "Unspent" ? null : fields[1];
                    data.push(cur);
                }
            };
            cb(null,data);
        }));
    }));                                                                              
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
        return " -o "+ x.addr + ":" + x.value;
    }));
    txop('mktx',args,true,null,null,cb);
}

m.showtx = function(tx,cb) { 
    txop("showtx",null,false,tx,null,eh(cb,function(shown) {
        try {
            var fields = shown.split('\n')
                .map(function(str) { return str.split(' ').filter(identity); })
    
            var inputs = [], outputs = [], hash = "";
            for (var i = 0; i < fields.length;) {
                if (fields[i][0] == "hash:") { hash = fields[i][1]; }
                if (fields[i][0] == "Input:") {
                    inputs.push({
                        prev: fields[i+1][2],
                        script: fields[i+2].slice(1,fields[i+2].length-1),
                        sequence: parseInt(fields[i+2][fields[i+2].length-1]),
                        address: (27 < (fields[i+3][1]||"").length < 34) ? fields[i+3][1] : null
                    }); i += 3;
                }
                else if (fields[i][0] == "Output:") {
                    outputs.push({
                        value: parseInt(fields[i+1][1]),
                        script: fields[i+2].slice(1),
                        address: fields[i+3][1]
                    }); i += 4;
                }
                else i++;
            }
            cb(null, { inputs: inputs, outputs: outputs, hash: hash });
        } catch(e) { cb(e); }
    }));
}

m.addr_to_pubkey = m.address_to_pubkey = function(addr,cb) {
    m.history(addr,eh(cb,function(h) {
        h = h.filter(function(o) { return o.spend });
        if (!h.length) {
            return cb("No spends from this address"); 
        }
        m.fetch_transaction(h[0].spend.substring(0,64),eh(cb,function(tx) {
            m.showtx(tx,eh(cb,function(shown) {
                var pub = shown.script[4];
                if (len(pub) == 66 || len(pub) == 130) { return cb(null,pub); }
                return cb("Failed to parse script: "+shown.script);
            }));
        }));
    }));
}

m.sign_input = function(tx,index,script,key,cb) { txop("sign-input",[index,script],false,tx,key,cb); }

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
        addr: to,   
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
            addr: change[i],
            value: Math.floor((sum-value-10000)/changelen) 
        });
    }
    m.mktx(utxo,outputs,cb);
}

m.txhash = function(tx,cb) {
    m.showtx(tx,eh(cb,function(shown) { cb(null,shown.hash); }));
}

// Converts a pk or list of pks to an addrdata object
// addrdata: { priv: _, pub: _, addr: _, hash160: _, raw: _ }
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
        function(cb2) { m.addr(addrdata.priv,adpusher('addr',cb2)) },
        function(cb2) { m.decode_addr(addrdata.addr,adpusher('hash160',cb2)) },
        function(cb2) {
            if (addrdata.addr[0] == '1') {
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
        var script = Array.prototype.concat.apply([k],results.map(function(pub) { return ['[',pub,']']; }))
            .concat([results.length,'checkmultisig']);
        m.rawscript(script,eh(cb,function(raw) {
            m.scripthash(raw,eh(cb,function(addr) {
                cb(null,{ raw: raw, script: script, addr: addr, n: results.length, k: k });
            }));
        }));
    }));
}

// Signs a transaction at index _index_ with the _addrdata_ object or a private key
m.sign_tx_input = function(tx,index,addrdata,cb) {
    if (typeof addrdata == "string") {
        return m.gen_addr_data(addrdata,eh(cb,function(res) {
            m.sign_input(tx,index,res,cb);
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

//Single-index helper for the below helper
m.apply_multisignatures_at_index = function(tx,script,index,sigobj,cb) {
    m.showscript(script,eh(cb,function(sc) {
        var n = parseInt(sc[sc.length-2]),
            k = parseInt(sc[0]),
            sigs = (sigobj || []).filter(function(x) { return x; });
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

//Helper method for applying multisignatures to a transaction
m.apply_multisignatures = function(tx,script,sigs,cb) {
    m.showtx(tx,eh(cb,function(shown) {
        m.foldr(_.range(shown.inputs.length),tx,function(tx,i,cb2) {
            m.apply_multisignatures_at_index(tx,script,i,sigs[i],cb2);
        },cb);
    }));
}

m.multisig_sign_tx_input = m.sign_input;

// Creates a transaction object txobj: { tx: _, sigs: [_] }
// Signs all multisig inputs conforming to the script with private key _pk_
// And applies signatures to the transaction automatically
m.multisig_sign_tx_inputs = function(txobj,script,pk,utxo,cb) {
    if (typeof txobj == "string") {
        txobj = { tx: txobj, sigs: [] }
    }
    else { //Function returns new object, does not mutate
        txobj = { tx: txobj.tx, sigs: txobj.sigs.slice(0) }
    }
    async.series({
        msigaddr: _.partial(m.scripthash,script),
        showscript: _.partial(m.showscript,script),
        showtx: _.partial(m.showtx,txobj.tx),
        pubkey: _.partial(m.pubkey,pk)
    },eh(cb,function(r) {
        var utxomap = {}, showtx = r.showtx, msigaddr = r.msigaddr,
            showscript = r.showscript, pubkey = r.pubkey;
        utxo.map(function(u) { utxomap[u.output] = u; });
        m.cbmap(_.range(showtx.inputs.length),function(i,cb3) {
            // Look for indices with the address we're trying to sign
            console.log('u',utxomap[showtx.inputs[i].prev].address,msigaddr);
            if (utxomap[showtx.inputs[i].prev].address == msigaddr) {
                m.multisig_sign_tx_input(txobj.tx,i,script,pk,eh(cb,function(sig) {
                    txobj.sigs[i] = txobj.sigs[i] || [];
                    var j = showscript.filter(function(x) { 
                        return x.length == 66 || x.length == 130; 
                    }).indexOf(pubkey);
                    //console.log('aa',txobj,i,script,pk,sig,j);
                    if (j == -1) { 
                        return cb3("Privkey does not match multisig script!"); 
                    }
                    txobj.sigs[i][j] = sig;
                    m.apply_multisignatures(txobj.tx,script,txobj.sigs,eh(cb,function(newtx) {
                        txobj.tx = newtx;
                        cb3(null,sig);
                    }));
                }));
            }
            else cb3(null,null);
        },eh(cb,function() { return cb(null,txobj); }));
    }));
}

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
                    return x.addr == utxomap[shown.inputs[i].prev].address;
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
            var addrs = addrdata.map(function(x) { return x.addr; });
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

m.load_electrum_wallet = function(wallet,cb,cbdone) {
    if (typeof wallet === "string") { wallet = { seed: wallet } }
    wallet.recv = wallet.recv || [];
    wallet.change = wallet.change || [];
    wallet.utxo = wallet.utxo || [];
    wallet.stxo = wallet.stxo || [];
    wallet.n = wallet.n || 5;
    wallet.update = wallet.update || function(){};
    wallet.last_recv_load = 0;
    wallet.last_change_load = 0;
    wallet.ready = false;

    cb = cb || function(){};
    cbdone = cbdone || function(){};

    var txouniq = function(arr) { return _.uniq(arr,false,function(x) { return x.output; }); }
    var reload_interval;

    wallet.refresh = function() {
        wallet.lastAccessed = new Date().getTime();
        if (!reload_interval) {
            reload_interval = setInterval(_.partial(wallet.reload,function(){}),15000);
        }
    }
    console.log("Seed:",wallet.seed);

    console.log("Loading change addresses...");

    var update_txoset = function(h) {
        var utxo = h.filter(function(x) { return !x.spend });
        var stxo = h.filter(function(x) { return x.spend });
        wallet.stxo = txouniq(wallet.stxo.concat(stxo));
        var stxids = wallet.stxo.map(function(x) { return x.output; });
        wallet.utxo = txouniq(wallet.utxo.concat(utxo))
            .filter(function(x) { return stxids.indexOf(x.output) == -1 });
    }

    async.series([function(cb2) {
        m.cbuntil(function(cb2) {
            m.genpriv(wallet.seed,wallet.change.length,1,eh(cb,function(key) {
                console.log(key);
                m.gen_addr_data(key,eh(cb,function(data) {
                    wallet.change.push(data);
                    m.history(data.addr,eh(cb,function(h) {
                        if (h.length > 0) {
                            update_txoset(h);
                            return cb2(null,false);
                        }
                        return cb2(null,true);
                    }));
                }));
            }));
        },cb2);
    },function(cb2) {
        console.log("Loaded " + wallet.change.length + " change addresses");
        console.log("Loading receiving addresses");
        var old_recv_length = wallet.recv.length;
        m.cbmap(_.range(wallet.recv.length,wallet.n),function(i,cb3) {
            m.genpriv(wallet.seed,i,0,eh(cb3,function(pk) {
                m.gen_addr_data(pk,cb3);
            }));
        },eh(cb2,function(data) {
            console.log("Have " + wallet.n + " receiving addresses (" + (wallet.n-old_recv_length) + " new)");
            wallet.recv = wallet.recv.concat(data);
            console.log("Loading history");
            m.history(wallet.recv.map(function(x) { return x.addr; }),eh(cb2,function(h) {
                var utxo = h.filter(function(x) { return !x.spend });
                wallet.utxo = txouniq(wallet.utxo.concat(utxo));
                cb2(null,true);
            }));
        }));
    },function(cb2) {
        console.log("Wallet ready");
        wallet.refresh();
        wallet.ready = true;
        cbdone(null,wallet);
    }]);


    
    wallet.getaddress = function(change,cb2) {
        wallet.refresh();
        if (typeof change == "function") {
            cb2 = change; change = false;
        }
        m.genpriv(wallet.seed,wallet.recv.length,change ? 1 : 0,eh(cb2,function(priv) {
            m.gen_addr_data(priv,eh(cb2,function(data) {
                if (!change) {
                    wallet.n++;
                    wallet.recv.push(data);
                    wallet.update();
                }
                else { wallet.change.push(data); }
                cb2(null,data);
            }));
        }));
    }

    wallet.listaddresses = function(cb2) {
        wallet.refresh();
        cb2(null,{
            recv: wallet.recv.map(function(x) { return x.addr; }),
            change: wallet.change.map(function(x) { return x.addr; })
        });
    }

    wallet.getmultiaddress = function(other,k,cb2) {
        wallet.refresh();
        m.genpriv(wallet.seed,wallet.recv.length,0,eh(cb2,function(priv) {
            m.genpub(priv,eh(cb2,function(pub) {
                m.gen_multisig_addr_data([pub].concat(other),k,eh(cb2,function(data) {
                    wallet.n++;
                    wallet.recv.push(data);
                    cb2(null,data);
                }));
            }));
        }));
    }

    wallet.reload = function(cb2) {
        var recv = wallet.recv.map(function(x) { return x.addr; });
        var change = wallet.change.map(function(x) { return x.addr; });

        if (new Date().getTime() - wallet.lastAccessed > 600) {
            clearInterval(reload_interval);
            reload_interval = null;
        }

        m.history(recv.concat(change),eh(cb2,function(h) {
            update_txoset(h);
            cb2(null,wallet);
        }));
    }

    wallet.getbalance = function(address,cb2) {
        wallet.refresh();
        if (typeof address == "function") {
            cb2 = address; address = null;
        }
        var sum = wallet.utxo.filter(function(x) { return x.addr == address || !address })
                .reduce(function(sum,txo) { return sum + txo.value; },0);
        cb2(null,sum);
    }

    wallet.send = function(to, value, cb2) {
        wallet.refresh();
        m.get_enough_utxo_from_history(wallet.utxo,value+10000,eh(cb2,function(utxo) {
            var lastaddr = wallet.change[wallet.change.length-1].addr;
            m.make_sending_transaction(utxo,to,value,lastaddr,eh(cb2,function(tx) {
                m.sign_tx_inputs(tx,wallet.recv.concat(wallet.change),wallet.utxo,eh(cb2,function(stx) {
                    var usedtxids = utxo.map(function(x) { return x.output });
                    wallet.utxo = _.filter(wallet.utxo,function(x) { return usedtxids.indexOf(x.output) == -1; });
                    wallet.reload(wallet.update);
                    console.log('broadcasting: ',stx);
                    m.validtx(stx,eh(cb2,function(v) {
                        console.log(v);
                        m.broadcast(stx,eh(cb2,function() {}));
                        wallet.getaddress(true,eh(cb2,function(data) {
                            cb2(null,stx);
                        }));
                    }));
                }));
            }));
        }));
    }

    cb(null,wallet);
}

if (process.argv.indexOf("server") >= 0) {

    var host = process.env['MONGO_NODE_DRIVER_HOST'] != null ? process.env['MONGO_NODE_DRIVER_HOST'] : 'localhost';
    var port = process.env['MONGO_NODE_DRIVER_PORT'] != null ? process.env['MONGO_NODE_DRIVER_PORT'] : Connection.DEFAULT_PORT;

    var db = new Db('nodesx-wal', new Server(host, port), {safe: false}, {auto_reconnect: true}, {});

    var Wallet;
    db.open(function(err,dbb) {
        db = dbb;
        db.collection('wallet',function(err,collection) { 
            if (err) { throw err; }
            Wallet = collection;
        }); 
    });

    var app = express();

    app.configure(function(){                                                                 
         app.set('views',__dirname + '/views');                                                  
         app.set('view engine', 'jade'); app.set('view options', { layout: false });             
         app.use(express.bodyParser());                                                          
         app.use(express.methodOverride());                                                      
         app.use(app.router);                                                                    
         app.use(express.static(__dirname + '/public'));                                         
    });

    var active_wallets = {};

    var mkrespcb = function(res,code,success) {
        return eh(function(e) { res.json(e,code); },success);
    }

    var retrieve = function(name,pw,cb) {
        if (active_wallets[name]) { 
            if (pw == active_wallets[name].pw) {
                 return cb(null,active_wallets[name]);
            }
            else { return cb("Bad password"); }
        }       
        Wallet.findOne({ name: name },eh(cb,function(w) {
            if (w) {
                if (pw == w.pw) { 
                    m.load_electrum_wallet(w,null,eh(cb,function(w2) {
                        cb(null,w2); 
                    }));
                }
                else { cb("Bad password"); }
            }
            else { cb(null,null); }
        }));
    }

    var hard_retrieve = function(req,cb) {
        var name = ""+req.param("name"),
            pw = sha256(""+req.param("pw"));
        retrieve(name,pw,eh(cb,function(w) { w ? cb(null,w) : cb("No wallet") }));
    }

    var finalize_wallet = function(w) {
        active_wallets[w.name] = w;
        w.update = function() {
            console.log("Updating wallet...");
            Wallet.update({name: w.name},w,function(){});
        }
    }
    
    app.get('/get',function(req,res) {
        var seed = sha256(""+req.param("name")+":"+req.param("pw")).substring(0,32),
            name = ""+req.param("name"),
            pw = sha256(""+req.param("pw"));

        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (w) {
                finalize_wallet(w);
                return res.json(w); 
            }
            m.load_electrum_wallet(seed,null,mkrespcb(res,400,function(w) {
                w.name = name;
                w.pw = pw;
                Wallet.insert(w,mkrespcb(res,400,function(w2) {
                    finalize_wallet(w);
                    console.log("Finished loading: ",w);
                    res.json(w);
                }));
            }));
        }));
    });
    app.get('/balance',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            w.getbalance(mkrespcb(res,400,function(balance) {
                return res.json(balance);
            }));
        }));
    });
    app.get('/addr',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            w.getaddress(mkrespcb(res,400,function(addr) {
                return res.json(addr);
            }));
        }));
    });
    var send = function(req,res) {
        var name = ""+req.param("name"),
            pw = sha256(req.param("pw")),
            to = req.param("to"),
            value = parseInt(req.param("value"));
        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (!w) { 
                return res.json("Wallet not found"); 
            }
            w.send(to,value,mkrespcb(res,400,function(tx) {
                return res.json(tx);
            }));
        }));
    }
    app.get('/send',send);
    app.post('/send',send);

    app.get('/',function(req,res) {                                                           
        res.render('main.jade',{});                                                           
    });

    app.listen(3191);
}

module.exports = m;
