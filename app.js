var express = require('express'),
    request = require('request'),
    cheerio = require('cheerio');

var app = express();

app.get('/', function(req, res) {
    request.get('https://oevf.aec.gov.au/VerifyEnrolment.aspx', function(error, response, body) {
        var $, o;

        if (!error && response.statusCode == 200) {
            $ = cheerio.load(body);
            o = [];

            $('#aspnetForm input, #aspnetForm select').each(function() {
                o.push($(this).attr('name'));
            });

            res.send(o.join("<br>\n"));
        }
    });
});

app.listen(3000);
