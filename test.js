var sx = require('./main.js'),
async = require('async'),
process = require('process'),
eh = sx.errHandle,
cbuntil = sx.cbuntil;
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
        cbuntil(
            function(cb2) { 
                console.log("Waiting for payment");
                sx.get_enough_utxo(addrdata.addr,100000,function(err,success) {
                    if (err) {
                        console.log(err); return cb2(null,false);
                    }
                    console.log(success); return cb2(null,true);
                });
            },
            eh(cb,function() { cb(null,addrdata,history); })
        );

    };
}, function(addrdata,history,cb) {
    sx.send(addrdata.pk,'1VubN5ipWkCpcQ3pn7c74FNhfnzo4vg3D',100000,addrdata.addr,eh(cb,function(tx) {
        console.log("Success: ",tx);
    }));
}],function(err,res) { console.log(err ? err : res); });
