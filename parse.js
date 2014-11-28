/* little node script to parse a few hundred pdfs and save results in a csv */
/* written by Timo Grossenbacher, August 2014 */
/* MIT licence */

var spawn = require('child_process').spawn;
var fs = require('fs');
var async = require('async');
var json2csv = require('json2csv');

var jsonData = [];

// helper function for converting all uppercase strings to properCase, i.e., first letter uppercase, rest lowercase
String.prototype.toProperCase = function() {
    return this.replace(/\w\S*/g, function(txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
};


// reads the pdfs directory and iterates over all files - initially called
var init = function() {
    fs.readdir('pdfs', function(err, files) {
        // once the directory is read, each file's filetype is doublechecked (in parallel), by applying the isPdf
        // function to each item in the files array
        if (err)
            throw err;
        async.filter(files, isPdf, function(pdfFiles) {
            // now, the pdfFiles array inside this callback only contains the files that are actually pdfs
            // each file is now processed by the process function, again in parallel (but this time, limited to max 100 parallel invocations - if not limited, less somehow crashes)
            // if all the executions of the process function have returned true, onProcessComplete is fired
            async.eachLimit(pdfFiles, 100, process, onProcessComplete);
        });
    });
};

// check if file is a pdf (actually, it only looks for the .pdf extension)
var isPdf = function(filename, callback) {
    var re = /.+\.pdf$/;
    callback(re.test(filename));
};

// read a pdf file using less, as soon as whole pdf is read, parse it
var process = function(file, callback) {
    // spawn a less process (that returns a stream)
    var less = spawn('less', [file], {
        cwd: 'pdfs'
    });
    // set stdout encoding to utf8
    less.stdout.setEncoding('utf8');

    var pdfData = '';
    // set what happens whenever data "comes out" of the stream
    less.stdout.on('data', function(data) {
        pdfData += data;
    });
    // set what happens when the pdf is fully read (and "end" is fired)
    less.stdout.on('end', function() {
        // parse the data using the parse function defined below, executed once per pdf
        // the parse function appends the parsed, extracted data to the global jsonData
        // returns null if everything went well 
        var err = parse(pdfData, file);
        if (err === null) console.log(file + ' parsed.');
        callback(err);
    });
};

// parse pdf file into a json object and push this object to jsonData
// called within the process function
var parse = function(data, file) {
    // if an error happens, return it, else return null
    // for each file, fill a jsonObject with data
    // the keys of the jsonObject will be the colum names, later on (onProcessComplete)
    var jsonObject = {};
    jsonObject.filename = file;
    // split the lines by \n whitespaces
    var lines = data.split(/(\r?\n)/g);

    // for some reason, the letter m is always followed by a space and an uppercase letter, which is not always correct 
    // this is an artifact from reading the pdf with less and I couldn't find another way than heuristically fixing it 
    // with the following function
    function fixMProblem(string) {
        var reversedString = string.split("").reverse().join("");
        reversedString = reversedString.replace(/\sm(?!ieh)(?!urt)/ig, 'm');
        // reverse back
        return reversedString.split("").reverse().join("");
    };
    // iterate over all lines
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var result;
        // line with "Kanton: KT" also contains name of the institution
        var re = /(.*)(Kanton: ([A-Z]{2}))/;
        if (result = re.exec(line)) {
            // result is now an array of capturing groups that can be accessed
            // the first capture group contains the name
            jsonObject.name = fixMProblem(result[1].trim()).toProperCase();
            // the second capture group contains "Kanton: XY", while the third contains XY
            jsonObject.kanton = result[3].trim();
        }
        // line with "Rechtsform: " also contains street
        var re = /(.*)(Rechtsform: (.*))/;
        if (result = re.exec(line)) {
            jsonObject.strasse = fixMProblem(result[1].trim()).toProperCase();
            // special case: "Ver waltung" needs to be fixed into "Verwaltung"
            jsonObject.rechtsform = result[3].trim().replace(/Verw altung/, 'Verwaltung');
        }
        // line with "Pflegeleistung " also contains municipality
        var re = /(([0-9]{4})(.*))(Pflegeleistung: (.*))/;
        if (result = re.exec(line)) {
            jsonObject.plz = result[2].trim();
            jsonObject.gemeinde = fixMProblem(result[3].trim()).toProperCase();
            // again, "M inuten" is wrong
            jsonObject.pflegeleistung = result[5].trim().replace(/M inuten/, 'Minuten');
        }
        // data fields
        var re = /([0-9]+\.[0-9]{2})\s+(([^ ]+[ ]{0,})+)/;
        if (result = re.exec(line)) {
            // further process second result group, 
            // which basically contains everything except trimhe category number at the beginning of the line
            var group = result[2];
            // only the 3 numbers at the end of the line (and some special characters) are matched
            var re = /\s{2,}([0-9.*'-]+)\s+[0-9.*'-]+\s+[0-9.*'-]+/;
            // the category number becomes the key, the \' character is replaced with an empty string
            // we only need the first number of the three, the other two numbers signify cantonal and national average, respectively,
            // and can be computed later on from the first number, if needed
            jsonObject[result[1].trim()] = re.exec(group)[1].replace(/'/, '');
        }
    }
    // push to jsonData
    jsonData.push(jsonObject);
    return null;
};

// executed after each pdf has been parsed into a JSON object and is thus stored in jsonData
// convert to csv string and write to altersheime.csv
var onProcessComplete = function(err) {
    if (err) throw err;
    // write to csv
    json2csv({
        data: jsonData,
        fields: Object.keys(jsonData[0])
    }, function(err, csv) {
        if (err) console.log(err);
        // once the json has been converted to csv format, write that csv straight to output.csv
        fs.writeFile('output.csv', csv, function(err) {
            if (err) throw err;
            // basically the last executed line in code
            console.log('Saved CSV.');
        });
    });
};

// ok, give it a go! 
init();
