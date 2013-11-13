// ----------------------------------------------------------------------------
//
// lib/read-blog.js - Read in a directory of files and create a blog structure.
//
// Copyright (c) 2013 Andrew Chilton. All rights resered.
//
// License: http://chilts.mit-license.org/2013/
//
// ----------------------------------------------------------------------------

// core
var fs = require('fs');

// npm
var xtend    = require('xtend');
var ini      = require('ini');
var yaml     = require('js-yaml');
var marked   = require('marked');
var textile  = require('textile-js');
var escape   = require('escape-html');
var moment   = require('moment');
var data2xml = require('data2xml')({
    attrProp : '@',
    valProp  : '#',
});
var debug    = require('debug')('blogz');

// ----------------------------------------------------------------------------

var defaults = {
    title       : '',
    description : '',
    base        : '',
    latestCount : 10,
    indexCount  : 10,
};

var validExt = {
    md      : true,
    textile : true,
    txt     : true,
    html    : true,
    json    : true,
    yaml    : true,
    ini     : true,
};

function readBlogSync(opts) {
    if ( !opts.domain ) {
        throw new Error("Provide a domain");
    }
    if ( !opts.contentDir ) {
        throw new Error("Provide a contentDir");
    }

    // set some defaults
    opts = xtend({}, defaults, opts);

    // set up some vars we're going to use
    var post    = {};
    var posts   = [];
    var reverse;
    var pages   = [];
    var archive = {};
    var tagged  = {};
    var rssXml;
    var atomXml;

    var now = new Date();
    var nowMoment = moment(now);

    // read all the files from the content dir
    var files = fs.readdirSync(opts.contentDir);

    // skip over any directories
    files = files.filter(function(filename) {
        return !fs.statSync(opts.contentDir + '/' + filename).isDirectory();
    });

    files.forEach(function(filename) {
        debug('Reading file ' + filename);

        var parts = filename.split(/\./);
        var basename = parts[0];
        var ext = parts[1];
        var date, dateMoment;

        // ignore any files that are not *.{md,textile,txt,html,json,yaml,ini}
        if ( !validExt[ext] ) {
            // ignoring this file
            return;
        }

        // strip any initial numbers from the post name
        if ( basename.match(/^\d+-/) ) {
            basename = basename.replace(/^\d+-/, '');
        }

        debug('* basename=' + basename);
        debug('* ext=' + ext);

        // set this to a default post with the 'name'
        post[basename] = post[basename] || {
            name    : basename,
            meta    : {
                title     : basename.split(/-/).map(function(str) { return str.substr(0, 1).toUpperCase() + str.substr(1); }).join(' '),
                date      : now,
                moment    : nowMoment,
                year      : nowMoment.format('YYYY'),
                month     : nowMoment.format('MM'),
                day       : nowMoment.format('DD'),
                monthname : nowMoment.format('MMMM'),
                tags    : [],
            },
            content : '',
            html    : '',
        };

        var contents = fs.readFileSync(opts.contentDir + '/' + filename, 'utf8');

        // META
        if ( ext === 'json' ) {
            try {
                post[basename].meta = xtend({}, post[basename].meta, JSON.parse(contents));
            }
            catch (e) {
                console.warn('Error parsing ' + filename + ' file : ' + e);
                process.exit(2);
            }
        }
        if ( ext === 'yaml' ) {
            try {
                post[basename].meta = xtend({}, post[basename].meta, yaml.load(contents));
            }
            catch (e) {
                console.log('Error parsing file ' + opts.contentDir + '/' + filename);
                throw e;
            }
        }
        if ( ext === 'ini' ) {
            post[basename].meta = xtend({}, post[basename].meta, ini.decode(contents));
        }

        // CONTENTS
        if ( ext === 'html' ) {
            post[basename].content = contents;
            post[basename].html    = contents;
        }
        if ( ext === 'md' ) {
            post[basename].content = contents;
            post[basename].html    = marked(contents);
        }
        if ( ext === 'textile' ) {
            post[basename].content = contents;
            post[basename].html    = textile(contents);
        }
        if ( ext === 'text' ) {
            post[basename].content = contents;
            post[basename].html    = '<pre>' + escape(contents) + '</pre>';
        }
    });

    // get all the posts into a list
    posts = Object.keys(post).map(function(name) {
        return post[name];
    });

    debug('Found ' + posts.length + ' posts');

    // convert and create all the times for all the posts
    posts.forEach(function(post) {
        // save this date as a regular JavaScript Date()
        post.meta.date = new Date(post.meta.date);

        // now save it as a moment()
        var dtMoment = moment(post.meta.date);
        post.meta.year  = dtMoment.format('YYYY');
        post.meta.month = dtMoment.format('MM');
        post.meta.day   = dtMoment.format('DD');

        post.meta.monthname = dtMoment.format('MMMM');
        post.meta.moment = dtMoment;
    });

    debug('Found ' + posts.length + ' posts');

    // sort the posts by chronological order
    posts = posts.filter(function(post) {
        // only return blog posts that have passed their 'date' (ie. published)
        return post.meta.date < now;
    }).sort(function(a, b) {
        // sort on date
        if ( a.meta.date.toISOString() < b.meta.date.toISOString() )
            return -1;
        if ( a.meta.date.toISOString() > b.meta.date.toISOString() )
            return 1;
        return 0;
    });

    debug('Found ' + posts.length + ' posts');

    // make sure each post has a prev and next
    posts.forEach(function(post, i) {
        if ( i > 0 ) {
            post.prev = posts[i-1];
        }
        if ( i < posts.length - 1 ) {
            post.next = posts[i+1];
        }
    });

    debug('Found ' + posts.length + ' posts');

    // get a copy of all the posts but reversed
    reverse = posts.slice(0);
    reverse.reverse();

    // set up an easy way to access the latest posts
    latest = reverse.slice(0, opts.latestCount);

    // ToDo: make the index pages ... !

    // make the archive
    posts.forEach(function(post) {
        var year = post.meta.year;
        var month = post.meta.month;

        // setup blank year and/or month lists
        archive[year] = archive[year] || {};
        archive[year][month] = archive[year][month] || [];

        // add this post to this month's archive
        archive[year][month].push(post);
    });

    // keep a list of all the tagged
    posts.forEach(function(post) {
        post.meta.tags.forEach(function(tag) {
            tagged[tag] = tagged[tag] || [];
            tagged[tag].push(post);
        });
    });

    // make the rss20.xml feed - firstly, make the RSS feed
    var rssData = {
        '@' : { version : '2.0' },
        channel : {
            title         : opts.title,
            description   : opts.description,
            link          : 'http://' + opts.domain + opts.base + '/rss20.xml',
            lastBuildDate : nowMoment.format("ddd, DD MMM YYYY HH:mm:ss ZZ"),
            pubDate       : nowMoment.format("ddd, DD MMM YYYY HH:mm:ss ZZ"),
            ttl           : 1800,
            item          : [],
        }
    };

    rssData.channel.item = latest.map(function(post, i) {
        return {
            title       : post.meta.title,
            description : post.html,
            link        : 'http://' + opts.domain + opts.base + '/' + post.name,
            guid        : 'http://' + opts.domain + opts.base + '/' + post.name,
            pubDate     : post.meta.moment.format("ddd, DD MMM YYYY HH:mm:ss ZZ"),
        };
    });

    rssXml = data2xml('rss', rssData);

    // make the atom.xml feed
    var atomData = {
        '@'     : { xmlns : 'http://www.w3.org/2005/Atom' },
        title   : opts.title,
        link    : {
            '@' : {
                href : 'http://' + opts.domain + opts.base + '/atom.xml',
                rel  : 'self',
            },
        },
        updated : moment().format(),
        id      : 'http://' + opts.domain + '/',
        author  : {
            name  : 'Andrew Chilton',
            email : 'andychilton@gmail.com',
        },
        entry   : [],
    };

    atomData.entry = latest.map(function(post, i) {
        return {
            title   : post.meta.title,
            id      : 'http://' + opts.domain + opts.base + '/' + post.name,
            link    : [
                {
                    '@' : { href : 'http://' + opts.domain + opts.base + '/' + post.name }
                },
                {
                    '@' : {
                        href : 'http://' + opts.domain + opts.base + '/' + post.name,
                        rel : 'self'
                    }
                }
            ],
            content : {
                '@' : { type : 'html' },
                '#' : post.html,
            },
            updated : post.meta.moment.format(),
        };
    });

    atomXml = data2xml('feed', atomData);

    return {
        posts   : posts,
        post    : post,
        pages   : pages,
        latest  : latest,
        archive : archive,
        tagged  : tagged,
        rss     : rssXml,
        atom    : atomXml,
    };
}

// ----------------------------------------------------------------------------

module.exports          = readBlogSync;
module.exports.readSync = readBlogSync;

// ----------------------------------------------------------------------------
