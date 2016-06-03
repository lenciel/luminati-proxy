// LICENSE_CODE ZON
'use strict'; /*jslint node:true, esnext:true*/
const _ = require('underscore');
const events = require('events');
const http = require('http');
const https = require('https');
const url = require('url');
const tls = require('tls');
const net = require('net');
const request = require('request');
const util = require('util');
const hutil = require('hutil');
const etask = hutil.etask;
const assign = Object.assign;
const agent = new http.Agent({keepAlive: true, keepAliveMsecs: 5000});
const E = module.exports = Luminati;

let write_http_reply = (stream, res, headers)=>{
    headers = assign(headers||{}, res.headers);
    if (stream instanceof http.ServerResponse)
        return stream.writeHead(res.statusCode, res.statusMessage, headers);
    var str = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
    Object.keys(headers).reduce((str, field)=>
        str+`${field}: ${headers[field]}\r\n`, str);
    stream.write(str+'\r\n');
};

let calculate_username = opt=>{
    let username = `lum-customer-${opt.customer}-zone-${opt.zone||'gen'}`;
    if (opt.country)
        username += `-country-${opt.country}`;
    if (opt.city)
        username += `-city-${opt.city}`;
    if (opt.session)
        username += `-session-${opt.session}`;
    if (opt.asn)
        username += `-asn-${opt.asn}`;
    if (opt.dns)
        username += `-dns-${opt.dns}`;
    if (opt.raw)
        username += '-raw';
    if (opt.direct)
        username += '-direct';
    return username;
};

let parse_authorization = header=>{
    if (!header)
        return;
    let m = header.match(/^Basic (.*)/);
    if (!m)
        return;
    header = new Buffer(m[1], 'base64').toString('ascii');
    let parts = header.split(':');
    let auth = {password: parts[1]};
    parts = parts[0].split('-');
    while (parts.length)
    {
        let key = parts.shift();
        if (key=='lum')
            continue;
        auth[key] = {direct: true, raw: true}[key] || parts.shift();
    }
    return auth;
};

function Luminati(opt){
    events.EventEmitter.call(this);
    const _this = this;
    _this.opt = opt;
    _this.stats = {};
    _this.active = 0;
    opt.proxy.forEach(proxy=>{
        _this.stats[proxy] = {
            active_requests: 0,
            max_requests: 0,
            status_code: {},
        };
    });
    let handler = (req, res, head)=>etask(function*request(){
        _this.active++;
        _this.emit('idle', false);
        this.on('ensure', ()=>{
            if (this.error)
            {
                _this._log('ERROR',
                    `${req.method} ${req.url} - ${this.error}`);
                if (!res.ended)
                {
                    write_http_reply(res, {statusCode: 502,
                        statusMessage: 'Bad Gateway',
                        headers: {Connection: 'close'}});
                }
                res.end();
            }
            if (--_this.active)
                return;
            _this.emit('idle', true);
        });
        req.on('error', this.ethrow_fn());
        req.on('timeout', ()=>this.ethrow(new Error('request timeout')));
        this.info.url = req.url;
        if (opt.pool_size && !req.headers['proxy-authorization'])
        {
            if (!_this.sessions)
            {
                _this.sessions = [];
                _this.session_id = 1;
                yield _this._pool(opt.pool_size);
                _this._log('DEBUG',
                    `initialized pool - ${_this.opt.pool_size}`);
                _this._pool_ready = true;
            }
            else
            {
                if (_this._pool_ready)
                {
                    if (!_this.sessions.length)
                    {
                        _this._log('WARNING', 'pool size is too small');
                        yield _this._pool(1);
                    }
                }
                for (;; yield etask.sleep(1000))
                {
                    if (!_this._pool_ready)
                        continue;
                    if (_this.sessions.length)
                        break;
                    _this._log('WARNING', 'pool size is too small');
                    yield _this._pool(1);
                    break;
                }
            }
        }
        yield _this._request(req, res, head);
    });
    _this.http = http.createServer((req, res, head)=>{
        if (req.headers.host=='trigger.domain' ||
            /^\/hola_trigger/.test(req.url))
        {
            return res.end();
        }
        if (!req.url.startsWith('http:'))
            req.url = 'http://'+req.headers.host+req.url;
        handler(req, res, head);
    });
    if (_this.opt.ssl)
    {
        _this.https = https.createServer(_this.opt.ssl, handler);
        _this.http.on('connect', (req, socket, head)=>{
            socket.write(`HTTP/1.1 200 OK\r\n\r\n`);
            socket.pipe(net.connect({host: '127.0.0.1',
                port: _this.https.address().port})).pipe(socket);
        });
    }
    else
        _this.http.on('connect', handler);
}

util.inherits(Luminati, events.EventEmitter);

Luminati.prototype.listen = etask._fn(function*listen(_this, port){
    let _http = _this.http, _https = _this.https;
    _http.on('error', err=>{
        _http.removeAllListeners('error');
        _this.emit('error', err);
        this.ethrow(err);
    }).listen(port||_this.opt.port||23000, ()=>{
        _http.removeAllListeners('error');
        _this.port = _http.address().port;
        if (!_https)
        {
            _this.emit('ready');
            return this.ereturn(_this);
        }
        _https.on('error', err=>{
            _https.removeAllListener('error');
            _this.emit('error', err);
            this.ethrow(err);
        }).listen(()=>{
            _https.removeAllListeners('error');
            _this.emit('ready');
            this.ereturn(_this);
        });
    });
    yield this.wait();
});

Luminati.prototype.stop = etask._fn(function*stop(_this){
    _this.http.stop(()=>{
        if (!_this.https)
            return this.ereturn(_this);
        _this.https.stop(()=>{
            return this.ereturn(_this);
        });
    });
    yield this.wait();
});

Luminati.prototype._pool = etask._fn(function*pool(_this, count, retries){
    let fetch = tryout=>etask(function*pool_fetch(){
        for (;; tryout++)
        {
            let session = `${_this.port}_${_this.session_id++}`;
            let username = calculate_username(assign({session: session},
                _.pick(_this.opt, 'customer', 'zone', 'country', 'city', 'asn',
                'raw', 'dns')));
            let proxy = _this.opt.proxy.shift();
            _this.opt.proxy.push(proxy);
            let opt = {
                url: 'http://lumtest.com/myip.json',
                proxy: `http://${username}:${_this.opt.password}@${proxy}:22225`,
                timeout: _this.opt.session_timeout,
            };
            let res, err;
            try {
                res = yield etask.nfn_apply(request, [opt]);
                if (res && res.statusCode==200 &&
                    res.headers['content-type'].match(/\/json/))
                {
                    let info = JSON.parse(res.body);
                    _this._log('DEBUG',
                        `new session added ${proxy}:${session}`,
                        {ip: info.ip});
                    _this.sessions.push({proxy: proxy, session: session,
                        count: 0, info: info});
                    return;
                }
            } catch(e){ err = e; }
            _this._log('WARNING',
                `Failed to establish session ${proxy}:${session}`, {
                    error: err,
                    code: res && res.statusCode,
                    headers: res && res.headers,
                    body: res && res.body,
                });
            if (retries && tryout>=retries)
                return this.ethrow(new Error('could not establish a session'));
        }
    });
    for (let i=0; i<count; i++)
        this.spawn(fetch(1));
    yield this.wait_child('all');
});

Luminati.log_level = {
    ERROR: 0,
    WARNING: 1,
    INFO: 2,
    DEBUG: 3,
};

Luminati.prototype._log = function(level, msg, extra){
    if (Luminati.log_level[level]>Luminati.log_level[this.opt.log])
        return;
    let args = [`${level}:${this.port}: ${msg}`];
    if (extra)
        args.push(extra);
    console.log.apply(console, args);
};

Luminati.prototype._request = etask._fn(function*(_this, req, res, head){
    let url = req.url;
    if (req.method=='CONNECT')
    {

        log('DEBUG', `** CONNECT`);
        let parts = url.split(':');
        if (parts[0].match(/^\d+\.\d+\.\d+\.\d+$/) && _this.opt.resolve)
        {
            log('DEBUG', `** IP: parts[0]`);
            parts[0] = yield _this.opt.resolve(parts[0])||parts[0];
        }
        url = parts.join(':');
    }
    _this._log('INFO', `${req.method} ${url}`);
    const timestamp = Date.now();
    let authorization =
        parse_authorization(req.headers['proxy-authorization']);
    let session = !authorization && _this.sessions && _this.sessions[0];
    let host = session&&session.proxy||_this.opt.proxy[0];
    let username = calculate_username(assign({}, _this.opt, {
        session: session && session.session,
        direct: _this.opt.direct && _this.opt.direct.include &&
            _this.opt.direct.include.test(url) ||
            _this.opt.direct && _this.opt.direct.exclude &&
            !_this.opt.direct.exclude.test(url) || false,
    }, authorization||{}));
    let password = authorization && authorization.password ||
        _this.opt.password;
    let stats = _this.stats[host];
    stats.active_requests++;
    stats.max_requests = Math.max(stats.max_requests, stats.active_requests);
    _this._log('DEBUG', `requesting using ${username}`);
    if (session)
    {
        session.count++;
        if (_this.opt.max_requests &&
            session.count>=_this.opt.max_requests)
        {
            _this.sessions.shift();
            _this._log('DEBUG', `switching session ${session.session}`);
            yield _this._pool(1);
        }
    }
    const timeline = {start: Date.now()};
    const response = {
        request: {
            method: req.method,
            url: url,
            headers: req.headers,
        },
        proxy: {
            host: host,
            username: username,
        },
        timeline: timeline,
    };
    const handler = (proxy, headers)=>etask(function*(){
        proxy.on('response', _res=>{
            timeline.response = Date.now()-timeline.start;
            stats.active_requests--;
            let code = `${_res.statusCode}`.replace(/(?!^)./g, 'x');
            stats.status_code[code] = (stats.status_code[code]||0)+1;
            _this._log('DEBUG',
                `${req.method} ${url} - ${_res.statusCode}`);
            write_http_reply(res, _res, headers);
            _res.pipe(res);
            _res.on('end', ()=>{
                timeline.end = Date.now()-timeline.start;
                _this.emit('response', Object.assign(response, {
                    status_code: _res.statusCode,
                    headers: Object.assign({}, _res.headers, headers||{}),
                }));
                this.ereturn();
            });
        }).on('connect', (_res, socket, _head)=>{
            timeline.connect = Date.now()-timeline.start;
            stats.active_requests--;
            write_http_reply(res, _res);
            Object.assign(response, {
                status_code: _res.statusCode,
                headers: _res.headers,
            });
            if (_res.statusCode!=200)
            {
                _this._log('ERROR',
                    `${req.method} ${url} - ${_res.statusCode}`);
                res.end();
                _this.emit('response', response);
                return this.ereturn();
            }
            _this._log('DEBUG', `CONNECT - ${_res.statusCode}`);
            socket.write(head);
            res.write(_head);
            socket.pipe(res).pipe(socket);
            socket.on('end', ()=>{
                timeline.end = Date.now()-timeline.start;
                _this.emit('response', response);
                this.ereturn();
            });
        }).on('error', this.ethrow_fn());
        yield this.wait();
    });
    const headers = {
        'proxy-authorization': 'Basic '+
            new Buffer(username+':'+password).toString('base64'),
    };
    if (req.socket instanceof tls.TLSSocket)
    {
        let _etask = this;
        response.request.url = `https://${req.headers.host}${req.url}`;
        http.request({
            protocol: 'http:',
            host: host,
            port: 22225,
            method: 'CONNECT',
            path: `${req.headers.host}:443`,
            headers: headers,
            agent: agent,
        }).on('connect', (_res, socket, _head)=>etask(function*(){
            timeline.connect = Date.now()-timeline.start;
            const proxy = https.request({
                host: req.headers.host,
                method: req.method,
                path: req.url,
                headers: req.headers,
                socket: socket,
                agent: false,
            });
            req.pipe(proxy);
            yield handler(proxy, _res.headers);
            _etask.ereturn();
        })).on('error', this.ethrow_fn()).end();
        return yield this.wait();
    }
    const proxy = http.request({protocol: 'http:', host: host, port: 22225,
        method: req.method, path: url, agent: agent,
        headers: assign(headers, req.headers)});
    if (req.method=='CONNECT')
        proxy.end();
    else
        req.pipe(proxy);
    yield handler(proxy);
});
