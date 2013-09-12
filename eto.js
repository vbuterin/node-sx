// Expanded Transaction Object
// {
//   tx: "string",
//   inputscripts: [
//      "input0-pubkey-or-script",
//      ...
//   ],
//   sigs: [
//      [ "output0-pubkey0-sig", "output0-pubkey1-sig", ...],
//      [ "output1-pubkey0-sig", "output1-pubkey1-sig", ...],
//      ...
//   ]
// }

var sx    = require('./sxlib.js'),
    _     = require('underscore'),
    async = require('async'),
    eh    = sx.eh,
    m     = {};

var identity = function(x) { return x; }

m.mketo = function(tx,scriptmap,utxo,cb) {
    var eto = {
        tx: tx,
        inputscripts: [],
        sigs: []
    }
    utxo = utxo || [];
    scriptmap = scriptmap || {};

    sx.showtx(tx,eh(cb,function(shown) {
        eto.sigs = Array(shown.inputs.length);
        sx.cbmap_seq(_.range(shown.inputs.length),function(i,cb2) {
            var inp = shown.inputs[i];
            async.waterfall([function(cb3) {
                // Look through UTXO to find the address matching each tx input
                var txo = utxo.filter(function(x) { return x.output == inp.prev })[0];
                if (txo) {
                    cb3(null,txo.address);
                }
                else {
                    // If not found, look in the blockchain
                    sx.fetch_transaction(inp.prev.substring(0,64),eh(cb3,function(tx) {
                        if (!tx) {
                            return cb3("Transaction input "+i+" not found in blockchain or txpool") 
                        }
                        sx.showtx(tx,eh(cb3,function(shown) {
                            cb3(null,shown.outputs[parseInt(inp.prev.substring(65))].address);
                        }));
                    }));
                }
            },function(address,cb3) {
                if (shown.inputs[i].script) {
                    eto.sigs[i] = true;
                }
                // Grab pubkey/script from scriptmap
                if (scriptmap[address]) {
                    return cb3(null,scriptmap[address]);
                }
                // Grab pubkey/script from existing signed output
                if (shown.inputs[i].script) {
                    var scr = shown.inputs[i].script;
                    if (scr[scr.length-1] == 'checksig') {
                        return cb3(null,scr.filter(function(x) { return x.length >= 66 })[0]);
                    }
                    if (scr[scr.length-1] == 'checkmultisig') {
                        return cb3(null,scr[scr.length-2]);
                    }
                }
                // Grab script from blockchain
                sx.addr_to_pubkey(adddress,eh(cb2,function(scr) {
                    scriptmap[address] = scr;
                    cb3(null,scr);
                }));
            }],cb2);
        },eh(cb,function(scripts) { 
            eto.inputscripts = scripts;
            cb(null,eto) 
        }));
    }));
}

m.extract_signatures = function(eto,cb) {
    if (typeof eto == "string") {
        eto = { tx: eto, sigs: [] }
    }
    sx.showtx(eto.tx,eh(cb,function(shown) {
        var o = [];
        for (var i = 0; i < shown.inputs.length; i++) {
            if (shown.inputs[i].script) {
                o = o.concat(shown.inputs[i].script.filter(function(x) {
                    return ['304'].indexOf(x.substring(0,3)) >= 0;
                }));
            }
            if (_.isArray(eto.sigs[i])) { o = o.concat(eto.sigs[i].filter(identity)); }
        }
        cb(null,o);
    }));
}

m.process_multisignatures = function(eto,cb) {
// Do we have enough signatures at any particular index?
    sx.foldr(_.range(eto.inputscripts.length),eto,function(eto,i,cb2) {
        if (sx.is_pubkey(eto.inputscripts[i]) || eto.sigs[i] === true) {
            cb2(null,eto);
        }
        else sx.apply_multisignatures_at_index(eto.tx,eto.inputscripts[i],i,eto.sigs[i],eh(cb2,function(newtx) {
            //console.log("Applied multisigs: ",eto.tx,eto.inputscripts[i],i,eto.sigs[i],newtx);
            if (newtx != eto.tx) {
                eto.sigs[i] = true;
                eto.tx = newtx;
            }
            cb2(null,eto);
        }));
    },cb);
}

m.signeto = function(eto,pk,cb) {
    var eto = sx.deepclone(eto); // Optional; remove to modify original object

    // Single-sig addresses: sign the input if it matches the privkey
    var process_pubkey = function(addrdata,inputaddress,i,cb2) {
        if (addrdata.address != inputaddress) {
            cb2(null,eto); 
        }
        else {
            sx.sign_tx_input(eto.tx,i,addrdata,eh(cb,function(tx) {
                eto.tx = tx;
                cb2(null,eto);
            }));
        }
    }

    // Multisig addresses: grab the script, and sign the tx with it
    var process_scripthash = function(addrdata,inputaddress,i,cb2) {
        sx.showscript(eto.inputscripts[i],eh(cb,function(shown2) {
            var j = shown2.filter(function(x) { 
                return x.length == 66 || x.length == 130; 
            }).indexOf(addrdata.pub);
            if (j == -1) {
                return cb2(null,eto);
            }
            sx.multisig_sign_tx_input(eto.tx,i,eto.inputscripts[i],pk,eh(cb2,function(sig) {
                eto.sigs[i] = eto.sigs[i] || [];
                eto.sigs[i][j] = sig; 
                cb2(null,eto);
            }));
        }));
    }

    sx.gen_addr_data(pk,eh(cb,function(addrdata) {
        sx.showtx(eto.tx,eh(cb,function(shown) {
            sx.foldr(_.range(shown.inputs.length),eto,function(eto,i,cb2) {
                var inp = shown.inputs[i],
                    ispub = sx.is_pubkey(eto.inputscripts[i]);
                var mkaddr = ispub ? sx.addr : sx.scripthash;
                mkaddr(eto.inputscripts[i],eh(cb2,function(inputaddress) {
                    if (ispub) {
                        process_pubkey(addrdata,inputaddress,i,cb2);
                    }
                    else { process_scripthash(addrdata,inputaddress,i,cb2); }
                }));
            },eh(cb,function(eto) {
                m.process_multisignatures(eto,cb);
            }));
        }));
    }));
}

m.apply_sig_to_eto = function(eto,sig,cb) {
    console.log('eto',eto);
    var eto = sx.deepclone(eto), // Optional; remove to modify original object
        status = "NOSIG";
    var process_pubkey = function(i,cb2) {
        var pubkey = eto.inputscripts[i];
        sx.rawscript(['[',sig,']','[',pubkey,']'],eh(cb,function(raw) {
            sx.validate_input(eto.tx,i,script,sig,raw,eh(cb,function(v) {
                if (v) {
                    if (eto.sigs[i] !== true) {
                        eto.sigs[i] = true;
                        status = "SUCCESS";
                        sx.set_input(eto.tx,i,raw,eh(cb,function(tx) {
                            eto.tx = tx;
                            cb(null,eto);
                        }));
                    }
                    else if (status != "SUCCESS") { status = "EXISTSIG" }
                }
                else { cb2(null,eto); }
            }));
        }));
    }

    var process_scripthash = function(i,cb2) {
        var script = eto.inputscripts[i];
        sx.showscript(script,eh(cb,function(shown) {
            var pubkeys = shown.filter(function(x) { 
                return x.length == 66 || x.length == 130; 
            });
            sx.foldr(_.range(pubkeys.length),eto,function(eto,j,cb2) { 
                sx.validate_input(eto.tx,i,script,sig,pubkeys[j],eh(cb,function(v) { 
                    if (v) {
                        if (eto.sigs[i] === true || (eto.sigs[i] && eto.sigs[i][j])) {
                            if (status != "SUCCESS") status = "EXISTSIG";
                        }
                        else {
                            status = "SUCCESS";
                            eto.sigs[i] = eto.sigs[i] || [];
                            eto.sigs[i][j] = sig;
                        }
                        cb2(null,eto);
                    }
                    else { cb2(null,eto); }
                }));
            },cb2);
        }));
    }

    sx.showtx(eto.tx,eh(cb,function(shown) {
        console.log(eto);
        sx.foldr(_.range(shown.inputs.length),eto,function(eto,i,cb2) {
            console.log(eto,i);
            (sx.is_pubkey(eto.inputscripts[i]) ? process_pubkey : process_scripthash)(i,cb2);
        },eh(cb,function(eto) {
            if (status == "SUCCESS") { 
                m.process_multisignatures(eto,cb); 
            }
            else if (status == "EXISTSIG") {
                cb("Input already signed");
            }
            else cb("Signature not valid for any input");
        }));
    }));
}

m.publish_eto = function(eto,cb) {
    sx.mode == 'eto' ? sx.broadcast(eto.tx,cb)
                     : sx.bci_pushtx(eto.tx,cb);
}

module.exports = m;
