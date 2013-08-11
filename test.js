var sx = require('./main.js'),
async = require('async'),
process = require('process'),
eh = sx.errHandle,
cbwhile = sx.cbwhile,
_ = require('underscore');

var dl = { listener: function(){} }

async.waterfall([function(cb) {
    seed = 'a45ab3566367728909a778482e328b0d'
    console.log("Choose Electrum wallet address index");
    process.stdin.on('data',function(text) { dl.listener(text); });
    dl.listener = function(text) { 
        sx.genpriv(seed,parseInt(text),0,eh(cb,function(pk) {
            sx.pubkey(pk,eh(cb,function(pub) {
                sx.addr(pk,eh(cb,function(addr) {
                    sx.decode_addr(addr,eh(cb,function(hash160) {
                        sx.qrcode(addr,eh(cb,function(qr) {
                            cb(null,{pk: pk, pub: pub, addr: addr, hash160: hash160, qr: qr});
                        }));
                    }));
                }));
            }));
        }));
    };
}, function(addrdata,cb) {
    console.log(addrdata);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    console.log("Press enter once you sent money to the address");
    dl.listener = function(text) {
        var history = [];
        cbwhile(
            function(cb2) { return cb2(null, history.length == 0); },
            function(cb2) {
                console.log("Waiting for history");
                sx.history(addrdata.addr,eh(cb2,function(h) {
                    history.splice(0,history.length);
                    while (h.length > 0) history.push(h.pop());
                    cb2(null,true);
                }));
            },
            eh(cb,_.partial(cb,null,addrdata,history))
        );

    };
}, function(addrdata,history,cb) {
    console.log('Output found: ',history);
    sx.mktx([history[0]],{'1VubN5ipWkCpcQ3pn7c74FNhfnzo4vg3D':10000},eh(cb,function(tx) {
        console.log('tx',tx);
        sx.rawscript(['dup','hash160','[',addrdata.hash160,']','equalverify','checksig'],eh(cb,function(rawscript) {
            console.log('rs',rawscript);
            sx.sign_input(tx,0,rawscript,addrdata.pk,eh(cb,function(sig) {
                console.log('sig',sig);
                sx.rawscript(['[',sig,']','[',addrdata.pub,']'],eh(cb,function(rawscript2) {
                    console.log('rs2',arguments);
                    sx.set_input(tx,0,rawscript2,eh(cb,function(tx) {
                        console.log('tx',tx);
                        sx.broadcast(tx,eh(cb,function(o) {
                            console.log('o',o);
                        }));
                    }));
                }));
            }));
        }));
    }));
}],function() { console.log(arguments); });
