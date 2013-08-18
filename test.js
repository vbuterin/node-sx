var sx = require('./main.js'),
async = require('async'),
process = require('process'),
eh = sx.errHandle,
cbuntil = sx.cbuntil;
_ = require('underscore');

var dl = { listener: function(){} }

var dls = [ function(){} ];
var redirector = function(i) { return function(cb) {  dls[i](cb) }; }

function pod(cb) {
    dls[dls.length - 1] = function(){};
    dls.push(cb);
    process.stdin.on('data',redirector(dls.length-1));
}

async.waterfall([function(cb) {
    var seed = 'a45ab3566367728909a778482e328b0d';
    sx.cbuntil(function(cb2) {
        console.log("REPL");
        pod(function(text) {
            var fields = (text+"").split(' ');
            if (fields[0] == "addr") {
                sx.genpriv(seed,parseInt(fields[1]),0,eh(cb,function(pk) {   
                    sx.gen_addr_data(pk,eh(cb,function(data) {
                        console.log(data);
                        return cb2(null,false);
                    }));
                }));
            }
            else if (fields[0] == "msigaddr") {
                sx.gen_multisig_addr_data(fields.slice(1,4),2,eh(cb,function(data) {
                    console.log(data);
                    return cb2(null,false);
                }));
            }
            else if (fields[0] == "mkmultitx") {
                sx.make_sending_transaction(fields[1],fields[2],parseInt(fields[3]),null,eh(cb,function(tx) {
                    console.log("Transaction: ",tx);
                    return cb2(null,false);
                }));
            }
            else if (fields[0] == "sign") {
                sx.multisig_sign_tx_inputs(fields[1],fields[2],fields[3],eh(cb,function(sigs) {
                    console.log(JSON.stringify(sigs));
                    return cb2(null,false);
                }));
            }
            else if (fields[0] == "apply") {
                var sigs = JSON.parse(fields.slice(3).join(' ').replace("'",'"'));
                sx.apply_multisignatures(fields[1],sigs,fields[2],eh(cb,function(tx) {
                    console.log(tx);
                    return cb2(null,false);
                }));
            }
            else if (fields[0] == "broadcast") {
                sx.broadcast(fields[1],eh(cb,function(data) {
                    return cb2(null,false);
                }));
            }
            else if (fields[0] == "exit") { return cb2(null,true); }
            else { console.log("Error, bad command"); return cb2(null,false); }
        });
    });
}]);

/*async.waterfall([function(cb) {
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
}],function(err,res) { console.log(err ? err : res); });*/
