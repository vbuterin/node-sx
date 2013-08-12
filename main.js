var cp = require('child_process'),
    exec = cp.exec,
    spawn = cp.spawn,
    _ = require('underscore'),
    fs = require('fs'),
    async = require('async');

require('long-stack-traces');

var strip = function(s) { return s.replace(/^\s+|\s+$/g, '') }
var identity = function(x) { return x; }

var errHandle = eh = function(fail, success) {
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

var cbuntil = function(f,cb) {
    f(eh(cb,function(res) {
        if (!res) { cbuntil(f,cb) }
        else cb(null,res);
    }));
}

var cbmap = function(array,f,cb) {
    var cbs = 0;
    var out = Array(array.length);
    for (var i = 0; i < array.length; i++) {
        cbs++;
        f(array[i],function(ii) { return eh(cb,function(v) {
            out[ii] = v;
            cbs--;
            if (cbs===0) { return cb(null,out); }
        }); }(i));
    };
}

var cbmap_seq = function(array,f,cb) {
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

var m = {};

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

var txop = function(arg, args, output_tx, tx, inp, cb) {
    async.waterfall([function(cb2) {
        var filename = '/tmp/sxnode-' + (""+Math.random()).substring(2,11);
        fs.writeFile(filename,tx || "",errHandle(cb,function() { cb2(null,filename); }));
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

m.showtx = function(tx,cb) { txop("showtx",null,false,tx,null,cb); }

m.sign_input = function(tx,index,script,key,cb) { txop("sign-input",[index,script],false,tx,key,cb); }

m.set_input = function(tx,index,inp,cb) { txop("set-input",[index],true,tx,inp,cb); }

m.broadcast = m.broadcast_tx = function(tx,cb) {
    async.waterfall([function(cb2) {
        var filename = '/tmp/sxnode-' + (""+Math.random()).substring(2,11);
        fs.writeFile(filename,tx || "",errHandle(cb,function() { cb2(null,filename); }));
    }, function(filename,cb2) {
        var p = spawn("sx",['broadcast-tx',filename]);
        p.stdin.end();
        var data = "";
        p.stdout.on('data',function(d) { data += d; console.log(""+d); });
        p.stdout.on('close',function() { cb2(null,data); });
        p.stdout.on('error',cb);
    }],cb);
}

m.get_enough_utxo = function(address,amount,cb) {
    m.history(address,eh(cb,function(h) {
        //console.log('ww',address,amount,cb,h);
        var utxo = h.filter(function(x) { return !x.spend });
        var valuecompare = function(a,b) { return a.value > b.value; }
        var high = utxo.filter(function(o) { return o.value >= amount; }).sort(valuecompare);
        if (high.length > 0) { return cb(null,high[0]); }
        utxo.sort(valuecompare);
        var totalval = 0;
        for (var i = 0; i < utxo.length; i++) {
            totalval += utxo[i].value;
            if (totalval >= amount) { return cb(null,utxo.slice(0,i+1)); }
        }
        return cb({ err: "Not enough money", value: totalval, needed: amount});
    }));
}

m.make_sending_transaction = function(prevs, to, value, change, cb) {
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
                m.rawscript(script, adpusher(addrdata,'raw',cb2));
            }
            else cb2();
        },
    ],eh(cb,function() { cb(null,addrdata); }));
}

m.sign_tx_input = function(tx,index,addrdata,cb) {
    if (typeof addrdata == "string") {
        return m.gen_addr_data(addrdata,eh(cb,function(res) {
            m.sign_input(tx,index,res,cb);
        }));
    }
    if (!addrdata.raw) { return cb("Malformed addrdata object or multisig address"); }
    console.log('si',tx,index);
    m.sign_input(tx,index,addrdata.raw,addrdata.priv,eh(cb,function(sig) {
        var script = ['[',sig,']','[',addrdata.pub,']'];
        m.rawscript(script,eh(cb,function(raw2) {
            m.set_input(tx,index,raw2,eh(cb,function(tx) {
                cb(null,tx);
            }));
        }));
    }));
}

m.multisig_sign_tx_input = function(tx,index,addrdata,cb) {
}

m.send = function(pk, to, value, change, cb) {
    async.waterfall( [
        function(cb2) { m.gen_addr_data(pk,cb2); },
        function(addrdata,cb2) { 
            console.log('u',addrdata);
            m.get_enough_utxo(addrdata.addr,value,eh(cb,function(utxo) { 
                m.make_sending_transaction(utxo, to, value, change, eh(cb,function(tx) {
                    cb2(null,addrdata,utxo,tx);
                }));
            }));
        },
        function(addrdata,utxo,tx,cb2) {
            addrdata.tx = tx;
            cbmap_seq(_.range(utxo.length),function(i,cb3) {
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

m.errHandle = errHandle;
m.cbuntil = cbuntil;
module.exports = m;
