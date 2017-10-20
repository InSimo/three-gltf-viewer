const fs = require('fs');
const express = require('express');
const app = express();
const path = require("path");
const multer  = require('multer');
const crypto = require('crypto');

app.use(express.static(__dirname));

const mkdirpSync = function (dirParts) {
    for (let i = 1; i <= dirParts.length; i++) {
        var dir = path.join.apply(null, dirParts.slice(0, i));
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
    }
    return path.join.apply(null,dirParts);
}

// Convert from normal to web-safe, strip trailing "="s
function base64web(base64) {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Convert from web-safe to normal, add trailing "="s
function base64normal(base64) {
    return base64.replace(/\-/g, '+').replace(/_/g, '/') + '=='.substring(0, (3*base64.length)%4);
}

var uploadDir = 'uploads';
mkdirpSync([uploadDir]);
var upload = multer({ dest: uploadDir+path.sep });

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname,'index.html'));
});

//console.log(crypto.getHashes());

// uploading models for sharing
// we want to store them based on the hash of their content, in order to dedup them and generate unique URLs
// however, we need to wait for the file content to be received in order to know its hash
// so we first let multer put the files in its temporary folder, before moving them to their final storage.
app.post('/upload', upload.fields([{name:'glb', maxCount: 1}]), function (req, res) {
    if (req.files.glb.length != 1) {
        res.end('One GLB file must be provided');
        return;
    }
    var glbfile_in = req.files.glb[0].path;
    var hasher = crypto.createHash('sha224').setEncoding('hex');
    fs.createReadStream(glbfile_in).pipe(hasher).on('finish',function() {
        var hash = hasher.read();
        console.log('Hash is',hash);
        var dir = mkdirpSync(['data',hash.substring(0,2),hash.substring(2,4),hash.substring(4)]);
        var glbfile_out = path.join(dir,'glb');
        if (!fs.existsSync(glbfile_out)) {
            console.log(glbfile_in, '->',glbfile_out);
            fs.renameSync(glbfile_in, glbfile_out);
        }
        else {
            fs.unlink(glbfile_in, function() {}); // async, but we don't care when it is finished
        }
        var hashb64 = base64web(new Buffer(hash, 'hex').toString('base64'));

        var sharePath = '/v'+hashb64;
        var shareUrl = req.protocol + '://' + req.get('host') + sharePath;
        console.log(shareUrl);
        res.end(shareUrl);
        //res.redirect(303,sharePath);
    });
});

var reHashB64 = /^[a-zA-Z0-9_-]{38}$/;

app.get('/v:hashb64', function(req, res) {
    hashb64 = req.params.hashb64;
    if (!reHashB64.test(hashb64)) {
        res.status(404).send('Not found');
        return;
    }
    var hash = new Buffer(base64normal(hashb64),"base64").toString('hex');
    console.log('Hash:', hash);
    var dir = path.join(__dirname,'data',hash.substring(0,2),hash.substring(2,4),hash.substring(4));
    if (!fs.existsSync(dir)) {
        res.status(404).send('Not found');
        return;
    }
    res.sendFile(path.join(__dirname,'index.html'));
});

app.get('/v:hashb64/model.glb', function(req, res) {
    hashb64 = req.params.hashb64;
    if (hashb64.length!=38 || !reHashB64.test(hashb64)) {
        res.status(404).send('Not found');
        return;
    }
    var hash = new Buffer(base64normal(hashb64),"base64").toString('hex');
    var dir = path.join(__dirname,'data',hash.substring(0,2),hash.substring(2,4),hash.substring(4));
    if (!fs.existsSync(dir)) {
        res.status(404).send('Not found');
        return;
    }
    var file = path.join(dir,'glb');
    if (!fs.existsSync(file)) {
        res.status(404).send('Not found');
        return;
    }
    res.type('model/gltf.binary');
    res.sendFile(file);
});

app.use(function (err, req, res, next) {
    console.error(err.stack);
    res.status(500).send('Something went wrong');
})

app.listen(3000, function(){
    console.log('server is up');
});
