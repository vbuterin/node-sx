var sx = require('./sxlib.js');
if (process.argv.indexOf("server") >= 0) {
    require('./server.js')();
};
sx.eto = require('/eto.js');
module.exports = sx;
