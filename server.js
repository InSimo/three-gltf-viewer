const fs = require('fs');
const express = require('express');
const app = express();
const path = require("path");
const multer  = require('multer');

app.use(express.static(__dirname));

var storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '.glb') //Appending .jpg
    }
  });
var upload = multer({ storage: storage }).single('obj');

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname+'/index.html'));
});

app.post('/upload', function (req, res) {
    //calling.aFunction();
    upload(req, res, function(err){
        if (err) {
            return res.end('Error uploading file');
        }
        res.end('File is uploaded');
    })
});

app.listen(3000, function(){
    console.log('server is up');
});