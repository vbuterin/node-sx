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

var Login = function() {
    namepass = "name="+el("name").value+"&pw="+el("pass").value;
    msg("Loading...");
    request("http://localhost:3191/get?"+namepass,function(r) {
        clearmsg();
        try {
            window.wallet = JSON.parse(r);
            el("notloggedin").style.display = "none";
            el("loggedin").style.display = "block";
            var a = el("addresses");
            a.innerHTML = window.wallet.recv.map(function(x) { return x.addr })
                .reduce(function(h,a) { return h + "<div>"+a+"</div><br>"; },"");
            clearInterval(interval);
            interval = setInterval(GetBalance,15000);
            el("balance").innerText = window.wallet.utxo.reduce(function(sum,txo) { return sum+txo.value },0) / 100000000;
        }
        catch(e) { console.log(e); }
    });
}

var Send = function() {
    msg("Sending");
    var value = Math.floor(parseFloat(el("value").value)*100000000);
    request("http://localhost:3191/send?"+namepass+"&to="+el("to").value+"&value="+value,function(r) {
        msg(r.substring(1,r.length-1));
        el("msg").style.fontFamily = "monospace";
        el("msg").style.fontSize = "small";
        GetBalance();
    });
}

var GetAddress = function() {
    request("http://localhost:3191/addr?"+namepass,function(r) {
        try {
            var addr = JSON.parse(r).addr;
            el("addresses").innerHTML += "<div>"+addr+"</div><br>";
        }
        catch(e) { console.log(e); }
    });
}

var GetBalance = function() {
    request("http://localhost:3191/balance?"+namepass,function(r) {
        el("balance").innerText = isNaN(parseInt(r)) ? r : (parseInt(r) / 100000000);
    });
}

GetBalance();
