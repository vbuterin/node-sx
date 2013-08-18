var cp = require('child_process'),
    exec = cp.exec,
    spawn = cp.spawn,
    _ = require('underscore'),
    fs = require('fs'),
    async = require('async');

require('long-stack-traces');

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
    for (var i = 0; i < array.length; i++) {
        f(array[i],function(ii) { return eh(cb,function(v) {
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

var cmdcall = function(arg,args,inp,cb) {
    if (!args) args = [];
    var p = spawn("sx",[arg].concat(args));
    if (inp) { 
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
m.history = function(addr,cb) {
    async.waterfall([
    _.partial(cmdcall,'history',[addr],null),
    function(htext,cb2) {
        cmdcall('fetch-last-height',null,null,eh(cb,function(height) {
            cb2(null,htext,parseInt(height));
        }));
    },function(htext,height,cb2) {
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
        cb2(null,data);
    }],cb);
}

m.scripthash = _.partial(cmdcall,'scripthash',null);
m.rawscript = function(inp,cb) { cmdcall('rawscript',inp,null,cb); }
m.showscript = function(inp,cb) { 
    cmdcall('showscript',null,inp,eh(cb,function(s) { cb(null,strip(s).split(' ')); }));
}

var txop = function(arg, args, output_tx, tx, inp, cb) {
    async.waterfall([function(cb2) {
        var filename = '/tmp/sxnode-' + (""+Math.random()).substring(2,11);
        fs.writeFile(filename,tx || "",eh(cb,function() { cb2(null,filename); }));
    }, function(filename,cb2) {
        args = [filename].concat(args || []);
        //console.log('fn',filename,'args',args,'a',arguments);
        var p = spawn("sx",[arg].concat(args));
        if (inp) { 
            p.stdin.write(inp); 
        }
        p.stdin.end();
        var data = "";
        p.stdout.on('data',function(d) { data += d; });
        p.stdout.on('close',function() { cb2(null,output_tx ? filename : data) });
        p.stdout.on('error',cb);
    },
    output_tx ? function(filename,cb2) { fs.readFile(filename,cb2); }
              : function(data,cb2) { cb2(null,strip(data)); }
    ], eh(cb,function(tx) { cb(null,""+tx) }));
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
    
            var inputs = []; outputs = [];
            for (var i = 0; i < fields.length;) {
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
            cb(null, { inputs: inputs, outputs: outputs });
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

m.get_enough_utxo = function(h,amount,cb) {
    //console.log('ww',address,amount,cb,h);
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

m.make_sending_transaction_from_utxo = function(prevs, to, value, change, cb) {
    var sum = prevs.map(function(x) { return x.value; })
        .reduce(function(a,b) { return a+b; },0);
    var outputs = [{
        addr: to,   
        value: value
    }]
    if (typeof change == "string") change = [change, change];
    for (var i = 0; i < change.length; i++) {
        if (sum-value <= 10000) break;
        outputs.push({ 
            addr: change[i],
            value: Math.floor((sum-value-10000)/change.length) 
        });
    }
    m.mktx(prevs,outputs,cb);
}

m.make_sending_transaction = function(from, to, value, change, cb) {
    if (!change) change = from;
    m.history(from,eh(cb,function(h) {
        m.get_enough_utxo(h,value,eh(cb,function(utxo) {
            m.make_sending_transaction_from_utxo(utxo, to, value, change, cb);
        }));
    }));
}

m.txhash = function(tx,cb) {
    m.showtx(tx,eh(cb,function(shown) {
        cb(null,shown.split('\n')[0].split(' ')[1]);
    }));
}

var adpusher = function(addrdata,key,cb2) { 
    return eh(cb2,function(val) {
    addrdata[key] = val; cb2();
}); }

m.gen_addr_data = function(pk,cb) {
    var addrdata = { priv: pk }
    async.waterfall([
        function(cb2) { m.pubkey(addrdata.priv,adpusher(addrdata,'pub',cb2)) },
        function(cb2) { m.addr(addrdata.priv,adpusher(addrdata,'addr',cb2)) },
        function(cb2) { m.decode_addr(addrdata.addr,adpusher(addrdata,'hash160',cb2)) },
        function(cb2) {
            if (addrdata.addr[0] == '1') {
                var script = ['dup','hash160','[',addrdata.hash160,']','equalverify','checksig'];
                addrdata.script = script;
                m.rawscript(script, adpusher(addrdata,'raw',cb2));
            }
            else cb2();
        },
    ],eh(cb,function() { cb(null,addrdata); }));
}

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
    },eh(cb,function(results) {
        var script = Array.prototype.concat.apply([k],results.map(function(pub) { return ['[',pub,']']; }))
            .concat([results.length,'checkmultisig']);
        m.rawscript(script,eh(cb,function(raw) {
            m.scripthash(raw,eh(cb,function(addr) {
                cb(null,{ raw: raw, script: script, addr: addr, n: results.length, k: k });
            }));
        }));
    }));
}

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

//Data can also be the script
m.apply_multisignatures_at_index = function(tx,index,sigobj,data,cb) {
    if (typeof data == "string") {
        return m.showscript(data,eh(cb,function(sc) {
            var n = parseInt(sc[sc.length-2]),
                k = parseInt(sc[0]);
            m.apply_multisignatures_at_index(tx,index,sigobj,{ script: data, n: n, k: k },cb);
        }));
    }
    var keys = Object.keys(sigobj).sort(function(a,b) { return a > b; });
    var sigs = [];
    for (var i = 0; i < keys.length; i++) {
        sigs.push(sigobj[keys[i]]);
    }
    var zeroes = [].concat(_.range(data.k,data.n).map(function() { return 'zero' }));
    var script = [].concat.apply(zeroes,sigs.map(function(sig) { return ['[',sig,']']; }))
        .concat(['[',data.script,']']);
    m.rawscript(script,eh(cb,function(r) {
        m.set_input(tx,index,r,eh(cb,function(ss) { cb(null,ss)}));
    }));
    
}

//Data can also be the script
m.apply_multisignatures = function(tx,sigs,data,cb) {
    m.showtx(tx,eh(cb,function(shown) {
        var o = { tx: tx }
        m.cbmap_seq(_.range(shown.inputs.length),function(i,cb2) {
            var isigs = {};
            for (var ind in sigs) { isigs[ind] = sigs[ind][i]; }
            m.apply_multisignatures_at_index(o.tx,i,isigs,data,eh(cb,function(tx) {
                o.tx = tx;   
                cb2();
            }));
        },eh(cb,function() { cb(null, o.tx); }));
    }));
}

m.multisig_sign_tx_input = m.sign_input;

m.multisig_sign_tx_inputs = function(tx,script,pk,cb) {
    m.showtx(tx,eh(cb,function(shown) {
        m.cbmap(_.range(shown.inputs.length),function(i,cb3) {
            m.multisig_sign_tx_input(tx,i,script,pk,cb3);
        },eh(cb,function(sigs) {
            m.showscript(script,eh(cb,function(shown2) {
                m.pubkey(pk,eh(cb,function(pub) {
                    var i = shown2.filter(function(x) { 
                        return x.length == 66 || x.length == 130; 
                    }).indexOf(pub);
                    var o = {};
                    o[i] = sigs;
                    return cb(null,o);
                }));
            }));
        }));
    }));
}

m.send = function(pk, to, value, change, cb) {
    async.waterfall( [
        function(cb2) { m.gen_addr_data(pk,cb2); },
        function(addrdata,cb2) { 
            m.make_sending_transaction(addrdata.addr, to, value, change, eh(cb,function(tx) {
                cb2(null,addrdata,utxo,tx);
            }));
        },
        function(addrdata,utxo,tx,cb2) {
            addrdata.tx = tx;
            m.cbmap_seq(_.range(utxo.length),function(i,cb3) {
                m.sign_tx_input(addrdata.tx,i,addrdata,eh(cb,function(tx) {
                    addrdata.tx = tx;
                    cb3();
                }));
            },eh(cb,function() { 
                m.broadcast(addrdata.tx);
                m.txhash(addrdata.tx,eh(cb,function(hash) {
                    cb2(null,{ tx: addrdata.tx, hash: hash });
                }));
            }));
    }],cb);
}

module.exports = m;
