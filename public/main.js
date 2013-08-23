var request = function(url,cb) {
    var xhr = new XMLHttpRequest();                                                       
    xhr.onreadystatechange = function () {                                                
        if (xhr.readyState == 4) {                                                          
            cb(xhr.responseText);
        }                                                                                   
    }                                                                                     
    xhr.open("GET", url, true);                                                           
    xhr.send();
}

var el = function(x) { return document.getElementById(x); }

var namepass = "";

var interval;

var msg = function(m) {
    el("msg").style.cssText = "display:block";
    el("msg").innerText = m;
}
var clearmsg = function() { el("msg").style.cssText = "display:none"; }

var loadwallet = function(r) {
    try {
        var response = JSON.parse(r);
        if (response == "Bad password") { return msg(response); }
        else window.wallet = response;
        el("notloggedin").style.display = "none";
        el("loggedin").style.display = "block";
        var a = el("addresses");
        a.innerHTML = window.wallet.recv.map(function(x) { return x.addr })
            .reduce(function(h,a) { return h + "<div>"+a+"</div><br>"; },"");
        clearInterval(interval);
        interval = setInterval(Reload,5000);
        el("balance").innerText = window.wallet.utxo.reduce(function(sum,txo) { return sum+txo.value },0) / 100000000;
    }
    catch(e) { console.log(e); }
}

var Login = function() {
    namepass = "name="+el("name").value+"&pw="+el("pass").value;
    msg("Loading...");
    request("/get?"+namepass,function(r) { clearmsg(); loadwallet(r) });
}

var Send = function() {
    msg("Sending");
    var value = Math.ceil(parseFloat(el("value").value)*100000000);
    request("/send?"+namepass+"&to="+el("to").value+"&value="+value,function(r) {
        msg(r.substring(1,r.length-1));
        el("msg").style.fontFamily = "monospace";
        el("msg").style.fontSize = "small";
        Reload();
    });
}

var GetAddress = function() {
    request("/addr?"+namepass,function(r) {
        try {
            var addr = JSON.parse(r).addr;
            el("addresses").innerHTML += "<div>"+addr+"</div><br>";
        }
        catch(e) { console.log(e); }
    });
}

var Reload = function(force) {
    var fprefix = force ? "reload=yes&" : "";
    request("/get?"+fprefix+namepass,loadwallet);
}
