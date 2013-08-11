var cp = require('child_process'),
    exec = cp.exec,
    spawn = cp.spawn,
    _ = require('underscore'),
    fs = require('fs'),
    async = require('async');

var strip = function(s) { return s.replace(/^\s+|\s+$/g, '') }
var identity = function(x) { return x; }

var errHandle = eh = function(fail, success) {
    return function(err, res) {
        if (err) {
            console.log(err);
            fail(err);
        }
        else {
            success(res);
        }
    };
};

var cbwhile = function(cond,f,cb) {
    cond(eh(cb,function(res) {
        if (res) { f(eh(cb,_.partial(cbwhile,cond,f,cb))); }
        else cb(null,true);
    }));
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
    var args = inputs.map(function(x) { return " -i "+x.output; });
    for (var o in outputs) { args.push(" -o "+o+":"+outputs[o]); }
    txop('mktx',args,true,null,null,cb);
}

m.showtx = function(tx,cb) { txop("showtx",null,true,tx,null,cb); }

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

m.errHandle = errHandle;
m.cbwhile = cbwhile;

module.exports = m;
