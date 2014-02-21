var sx = require('./main')
var express = require('express')

var app = express();                                                                      
                                                                                          
app.configure(function() {                                                                
     app.set('views',__dirname + '/views');                                               
     app.set('view engine', 'jade'); app.set('view options', { layout: false });          
     //app.use(express.bodyParser());                                                       
     //app.use(express.cookieParser());                                                     
     //app.use(allowCrossDomain);
     app.use(app.router);                                                                 
     app.use(express.static(__dirname + '/public'));                                      
});


var allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', "*");
    //res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    //res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
}

app.post('/pushtx',function(req,res,next) {
    res.header('Access-Control-Allow-Origin', "*");
    sx.bci_pushtx(req.data,sx.eh(function(r) { res.json(r,400); }, function(r) { res.json(r) }))
});

app.get('/history/:address',function(req,res,next) {
    console.log(req.param('address'))
    res.header('Access-Control-Allow-Origin', "*");
    sx.history(req.param('address'),sx.eh(function(r) { res.json(r,400); }, function(r) { res.json(r) }))
});

app.get('/fetchtx/:txid',function(req,res,next) {
    res.header('Access-Control-Allow-Origin', "*");
    sx.fetch_transaction(req.param('txid'),sx.eh(function(r) { res.json(r,400); }, function(r) { res.json(r) }))
});

app.listen(3001);

return app;
