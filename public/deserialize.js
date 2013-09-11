var numToBytes = function(num,bytes) {
    if (bytes == 0) return [];
    else return [num % 256].concat(numToBytes(Math.floor(num / 256),bytes-1));
}
Bitcoin.Util.numToVarInt = function(num) {
    if (num < 253) return [num];
    else if (num < 65536) return [253].concat(numToBytes(num,2));
    else if (num < 4294967296) return [254].concat(numToBytes(num,4));
    else return [253].concat(numToBytes(num,8));
}

Bitcoin.Transaction.deserialize = function(buffer) {
    var pos = 0;
    var readAsInt = function(bytes) {
        if (bytes == 0) return 0;
        pos++;
        return buffer[pos-1] + readAsInt(bytes-1) * 256;
    }
    var readVarInt = function() {
        pos++;
        if (buffer[pos-1] < 253) {
            return buffer[pos-1];
        }
        return readAsInt(buffer[pos-1] - 251);
    }
    var readBytes = function(bytes) {
        pos += bytes;
        return buffer.slice(pos - bytes, pos);
    }
    var readVarString = function() {
        var size = readVarInt();
        return readBytes(size);
    }
    var obj = {
        ins: [],
        outs: []
    }
    obj.version = readAsInt(4);
    var ins = readVarInt();
    for (var i = 0; i < ins; i++) {
        obj.ins.push({
            outpoint: {
                hash: Bitcoin.Util.bytesToBase64(readBytes(32)),
                index: readAsInt(4)
            },
            script: new Bitcoin.Script(readVarString()),
            sequence: readAsInt(4)
        });
    }
    var outs = readVarInt();
    for (var i = 0; i < outs; i++) {
        obj.outs.push({
            value: readBytes(8),
            script: new Bitcoin.Script(readVarString())
        });
    }
    obj.locktime = readAsInt(4);
    return new Bitcoin.Transaction(obj);
}
