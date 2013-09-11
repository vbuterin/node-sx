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
var qs = function(x) { return document.querySelectorAll(x); }

function smartEncode(x) {
    var s = (typeof x == "object") ? JSON.stringify(x) : x;
    return encodeURIComponent(s);
}

var urlparams = function(obj) {
    var o = "";
    for (var key in obj) {
        o += "&" + encodeURIComponent(key) + "=" + smartEncode(obj[key]);
    }
    return o.substring(1);
}
var merge = function(o1, o2, etc) {
    var o = {}
    for (var i = 0; i < arguments.length; i++) {
        for (var k in arguments[i]) {
            o[k] = arguments[i][k];
        }
    }
    return o;
}
var setter = function(obj,prop) {
    return function(val) {
        if (obj[prop] != val) { obj[prop] = val; }
        return val;
    }
}
