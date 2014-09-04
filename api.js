"use strict";

var express = require('express'),
    request = require('request'),
    cheerio = require('cheerio'),
    _ = require('underscore'),
    app = express();

app.use(require('body-parser')());
app.use(require('cookie-parser')());

var AEC = {
    _lastCacheUpdate: 0,
    _cache: {},
    _validFields: ['__LASTFOCUS', '__EVENTTARGET', '__EVENTARGUMENT', '__VIEWSTATE', 
        '__EVENTVALIDATION', 'ctl00$ContentPlaceHolderBody$buttonVerify'],

    get baseURL() {
        return "https://oevf.aec.gov.au";
    },

    get verifyURL() {
        return AEC.baseURL + "/VerifyEnrolment.aspx"
    },

    generateCode: function() {
        var o = [], i;
        
        for (i = 0; i < 32; ++i) {
            o.push(Math.round(Math.random() * 15).toString(16));
        }

        return o.join("");
    },

    generateCaptchaURL: function(cid, type, time) {
        var url = AEC.baseURL + "/BotDetectCaptcha.ashx?get=";
        url += type;
        url += "&c=verifyenrolment_ctl00_contentplaceholderbody_captchaverificationcode";
        url += "&t=" + cid;
        url += "&d=" + time;
        url += "&e=1";
        return url;
    },

    generateCaptcha: function(cid) {
        var time = Date.now();
        return {
            image: AEC.generateCaptchaURL(cid, "image", time),
            sound: AEC.generateCaptchaURL(cid, "sound", time)
        };
    },

    generateJSONRequest: function(url, data) {
        return {
            url: url,
            method: "POST",
            json: true,
            headers: {
                "Content-Type": "application/json; charset=UTF-8"
            },
            body: JSON.stringify(data)
        };
    },

    updateCachedFormData: function(callback) {
        request.get(AEC.baseURL, function(err, resp, body) {
            if (!err && resp.statusCode == 200) {
                var $ = cheerio.load(body),
                    formData = {};
                
                AEC._validFields.forEach(function(name) {
                    formData[name] = $("#aspnetForm [name='" + name + "']").attr('value') || "";
                });

                AEC._cache.formData = formData;
                AEC._lastCacheUpdate = Date.now();
            }
            
            if (callback) {
                callback(_.clone(AEC._cache.formData));
            }
        });
    },

    cache: {
        getFormData: function(callback) {
            // Check hourly
            if (AEC._lastCacheUpdate < Date.now() - 3600000) {
                AEC.updateCachedFormData(callback);
            } else {
                callback(_.clone(AEC._cache.formData));
            }
        }
    }
};

// GETTING A CAPTCHA WILL SET A COOKIE
app.route('/captcha/:type/:cid/:time')
.get(function(req, res) {
    var url = AEC.generateCaptchaURL(req.params.cid,
                                     req.params.type,
                                     req.params.time);

    request(url).pipe(res);
});

app.get('/suburbs/:postcode', function(req, res) {
    res.type('json');

    request(AEC.generateJSONRequest(AEC.verifyURL + '/GetDropDownContents', {
        category: "postcode",
        knownCategoryValues: req.params.postcode
    })).pipe(res);
});

app.get('/street/:postcode/:suburb/:name', function(req, res) {
    //res.setHeader('Content-Type', "application/json");
    res.type('json');
    
    request(AEC.generateJSONRequest(AEC.verifyURL + '/GetStreetAutoCompleteList', {
        contextKey: req.params.suburb + ";" + req.params.postcode,
        count: 50,
        prefixText: req.params.name
    })).pipe(res);
});

app.route('/verify')
.post(function(req, res) {
    res.type('json');

    var givenNames = req.body.givenNames.toUpperCase(),
        familyName = req.body.familyName.toUpperCase(),
        postcode = req.body.postcode.toUpperCase(),
        suburb = req.body.suburb.toUpperCase(),
        streetName = req.body.streetName.toUpperCase(),
        captchaID = req.body.captchaID,
        captchaCode = req.body.captchaCode.toUpperCase();

    AEC.cache.getFormData(function(data) {
        var prefix = "ctl00$ContentPlaceHolderBody$",
            precap = "LBD_VCID_verifyenrolment_ctl00_contentplaceholderbody_captchaverificationcode";

        data[prefix + "textSurname"] = familyName;
        data[prefix + "textGivenName"] = givenNames;
        data[prefix + "textStreetName"] = streetName;
        data[prefix + "textPostcode"] = postcode;
        data[prefix + "DropdownSuburb"] = suburb;
        data[precap] = captchaID;
        data[prefix + "textVerificationCode"] = captchaCode;

        request({
            url: AEC.verifyURL,
            method: "POST",
            form: data,
            headers: {
                "Cookie": "ASP.NET_SessionId=" + req.cookies['ASP.NET_SessionId']
            }
        }, function(err, resp, body) {
            var $ = cheerio.load(body),
                prefix = "ctl00_ContentPlaceHolderBody_row",
                o = {};

            ["Division", "StateDistrict", "LGA", "LGAWard"].forEach(function(area) {
                o[area] = $("#" + prefix + area).children().last().text().trim();
            });

            res.write(JSON.stringify(o));
            res.end();
        });
    });
})
.get(function(req, res) {
    // This is just a dodgy test page.
    res.type('html');

    var page = "<form method='post'>";

    ['givenNames',
     'familyName',
     'postcode',
     'suburb',
     'streetName',
     'captchaCode'].forEach(function(name) {
        page += "<input placeholder='" + name + "' name='" + name + "'><br>";
    });

    var code = AEC.generateCode();
    page += "<input type='hidden' name='captchaID' value='" + code + "'>";
    page += "<img src='/captcha/image/" + code + "/" + Date.now() + "'><br>";
    page += "<br><input type='submit'></form>";

    res.write(page);
    res.end();
});

var server = app.listen(3000, function() {
    console.log('Listening on port %d', server.address().port);
});
