const fs = require('fs');
const fetch = require('node-fetch');
const crypto = require('crypto');

var input = require('./licenses.json');
var output = input;

var promises = [];

Promise.all(Object.entries(input).map( e => {
  var [key, value] = e;
  var texturi = value.text || (value.uri + 'legalcode.txt');
  return fetch(texturi).then(response => {
    return response.text() })
    .then(text => {
      // remove '=+' and whitespaces to being as independent as possible to changes of formatting
      text = text.replace(/=+/g, '').replace(/\s+/g, ' ');
      var hash = crypto.createHash('sha224').update(text).digest('hex');
      output[key].hash_sha224 = hash;
    })
})).then( r => {
  var outputJson = JSON.stringify(output, undefined, 2);
  var outputStream = fs.createWriteStream('./licenses.json');
  outputStream.end(outputJson);
});
