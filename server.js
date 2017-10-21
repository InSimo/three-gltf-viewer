const fs = require('fs');
const os = require('os');
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

const moveWithCopy = function(fIn, fOut) {
    fs.createReadStream(fIn).pipe(fs.createWriteStream(fOut)).on('end',function(){ fs.unlink(fIn,function(){}); });
}

// Convert from normal to web-safe, strip trailing "="s
function base64web(base64) {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Convert from web-safe to normal, add trailing "="s
function base64normal(base64) {
    return base64.replace(/\-/g, '+').replace(/_/g, '/') + '=='.substring(0, (3*base64.length)%4);
}

var uploadDir = mkdirpSync(['data','uploads']);
var upload = multer({ dest: uploadDir+path.sep });

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname,'index.html'));
});

//console.log(crypto.getHashes());

// uploading models for sharing
// we want to store them based on the hash of their content, in order to dedup them and generate unique URLs
// however, we need to wait for the file contents to be received in order to know their hash
// so we first let multer put the files in its temporary folder, before moving them to their final storage.
app.post('/upload', upload.fields([{name:'glb', maxCount: 1},{name:'image', maxCount: 1},{name:'view', maxCount: 1}]), function (req, res) {
    console.log('BODY:',req.body);
    if (req.files.glb.length != 1) {
        res.status(404).send('One GLB file must be provided');
        return;
    }
    // First we compute the hash for all input files
    var glbIn = req.files.glb[0].path;
    var imageIn = undefined;
    var viewIn = undefined;
    //var index = {};
    var index = Object.assign({}, req.body);
    var hashes = {};
    var promises = [];
    var fields = ['glb'];
    if (req.files.image !== undefined) {
        imageIn = req.files.image[0].path;
        fields.push('image');
    }
    if (req.files.view !== undefined) {
        viewIn = req.files.view[0].path;
    }
    fields.forEach(function(upField) {
        req.files[upField].forEach(function(upFile) {
            var fileIn = upFile.path;
            var hasher = crypto.createHash('sha224').setEncoding('hex');
            promises.push(new Promise(function(resolve, reject) {
                fs.createReadStream(fileIn).pipe(hasher).on('finish',function() {
                    var hash = hasher.read();
                    console.log(upField,'hash is',hash);
                    hashes[upField] = hash;
                    resolve(hash);
                })
            }));
        });
    });
    if (req.files.view !== undefined) {
        promises.push(new Promise(function(resolve, reject) {
            fs.readFile(req.files.view[0].path,'utf8', function(err, data) {
                if (err) {
                    reject(err);
                    return;
                }
                index.view = JSON.parse(data);
                resolve(index.view);
            });
        }));
    }
    Promise.all(promises).then(function(d) {
        index.glb = base64web(new Buffer(hashes.glb, 'hex').toString('base64'));
        if (imageIn !== undefined) {
            index.image = base64web(new Buffer(hashes.image, 'hex').toString('base64'));
        }
        var indexJson = JSON.stringify(index);
        console.log(indexJson);
        var hasher = crypto.createHash('sha224').setEncoding('hex');
        hasher.update(indexJson);
        var hash = hasher.digest('hex');
        console.log('Index hash is',hash);
        var dir = mkdirpSync(['data',hashes.glb.substring(0,2),hashes.glb.substring(2,4),hashes.glb.substring(4)]);
        var glbOut = path.join(dir,'model.glb');
        if (!fs.existsSync(glbOut)) {
            console.log(glbIn, '->',glbOut);
            fs.renameSync(glbIn, glbOut);
        }
        else {
            fs.unlink(glbIn, function() {}); // async, but we don't care when it is finished
        }
        if (imageIn !== undefined) {
            var imageOut = path.join(dir,hashes.image+'.png');
            console.log('imageOut',imageOut);
            if (!fs.existsSync(imageOut)) {
                console.log(imageIn, '->',imageOut);
                fs.renameSync(imageIn, imageOut);
            }
            else {
                fs.unlink(imageIn, function() {}); // async, but we don't care when it is finished
            }
        }
        if (viewIn !== undefined) {
            fs.unlink(viewIn, function() {}); // async, but we don't care when it is finished
        }
        var indexStream = fs.createWriteStream(path.join(dir,hash+'.json'));
        indexStream.end(indexJson);

        var glbHashb64 = base64web(new Buffer(hashes.glb, 'hex').toString('base64'));
        var hashb64 = base64web(new Buffer(hash, 'hex').toString('base64'));
        var sharePath = '/v'+glbHashb64;
        if (imageIn !== undefined || viewIn !== undefined) {
            sharePath += '.'+hashb64;
        }
        var shareUrl = req.protocol + '://' + req.get('host') + sharePath;
        console.log(shareUrl);
        res.end(shareUrl);
        //res.redirect(303,sharePath);
    });
});

var reHashB64 = /^[a-zA-Z0-9_-]{38}$/;

app.get('/v:hashb64', function(req, res) {
    hashb64 = req.params.hashb64.substring(0,38);
    hindexb64 = undefined;
    if (req.params.hashb64.length == 2*38+1 && req.params.hashb64[38] == '.') {
        hindexb64 = req.params.hashb64.substring(39);
    }
    if (!reHashB64.test(hashb64) || (hindexb64 !== undefined && !reHashB64.test(hindexb64))) {
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
    if (!reHashB64.test(hashb64)) {
        res.status(404).send('Not found');
        return;
    }
    var hash = new Buffer(base64normal(hashb64),"base64").toString('hex');
    var dir = path.join(__dirname,'data',hash.substring(0,2),hash.substring(2,4),hash.substring(4));
    if (!fs.existsSync(dir)) {
        res.status(404).send('Not found');
        return;
    }
    var file = path.join(dir,'model.glb');
    if (!fs.existsSync(file)) {
        res.status(404).send('Not found');
        return;
    }
    res.type('model/gltf.binary');
    res.sendFile(file);
});

app.get('/v:hashb64/:hindexb64.json', function(req, res) {
    hashb64 = req.params.hashb64;
    hindexb64 = req.params.hindexb64;
    if (!reHashB64.test(hashb64) || !reHashB64.test(hindexb64)) {
        res.status(404).send('Not found');
        return;
    }
    var hash = new Buffer(base64normal(hashb64),"base64").toString('hex');
    var hindex = new Buffer(base64normal(hindexb64),"base64").toString('hex');

    var dir = path.join(__dirname,'data',hash.substring(0,2),hash.substring(2,4),hash.substring(4));
    var file = path.join(dir,hindex+'.json');
    if (!fs.existsSync(file)) {
        res.status(404).send('Not found');
        return;
    }
    res.type('application/json');
    res.sendFile(file);
});

app.get('/v:hashb64/:himageb64.png', function(req, res) {
    hashb64 = req.params.hashb64;
    himageb64 = req.params.himageb64;
    if (!reHashB64.test(hashb64) || !reHashB64.test(himageb64)) {
        res.status(404).send('Not found');
        return;
    }
    var hash = new Buffer(base64normal(hashb64),"base64").toString('hex');
    var himage = new Buffer(base64normal(himageb64),"base64").toString('hex');

    var dir = path.join(__dirname,'data',hash.substring(0,2),hash.substring(2,4),hash.substring(4));
    var file = path.join(dir,himage+'.png');
    if (!fs.existsSync(file)) {
        res.status(404).send('Not found');
        return;
    }
    res.type('image/png');
    res.sendFile(file);
});

app.use(function (err, req, res, next) {
    console.error(err.stack);
    res.status(500).send('Something went wrong');
})

var server = app.listen(5000, undefined, function(){
    // print server URLs to the console, so that the browser can be started by Ctrl+click
    var host = server.address().address;
    var port = server.address().port;
    console.log('Serving!');
    console.log('- Local:             http://localhost:'+port);
    var ip = undefined;
    for (var intf of Object.values(os.networkInterfaces())) {
        for (var a of intf) {
            if (ip === undefined && !a.internal && a.family === 'IPv4') {
                ip = a.address;
            }
        }
    }
    if (ip) {
        console.log('- On Your Network:   http://'+ip+':'+port);
    }
    console.log('');
});
