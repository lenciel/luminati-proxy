# Luminati HTTP/HTTPS/SOCKS Proxy Manager

A forward HTTP/HTTPS proxy on your side, to accelerate/compress/rotate/distribute/manage/monitor/report/log/debug traffic to your proxies around the world.

This tool requires a [Luminati](https://luminati.io/?cam=github-proxy) account.

## Features
- Highly scalable
- Connection pool for faster response time
- Easy setup for multiple configurations using a simple web interface
- Statistics
- Automatically rotate IP every X requests
- Load balancing using multiple Super Proxies
- SSL sniffing (using a self-signed certificate)

## Installation

### Windows
- Install [Git](https://git-scm.com/download/win)
- Install [Node.js](https://nodejs.org/en/download/)
- Install Luminati Proxy from Window's command prompt:
```sh
npm install -g luminati-io/luminati-proxy
```

### Linux/MacOS
- Install Node.js (preferably using [nave](https://github.com/isaacs/nave))
- Install Luminati Proxy from the terminal prompt:
```sh
$ sudo npm install -g luminati-io/luminati-proxy
```

## Usage

```sh
$ luminati-proxy -h
```

or if you want to run a proxy using remote dns resolve with us ip:

```sh
$ luminati-proxy -p 23000 --log --customer lum-customer-LUMINATI_ACCOUNT-zone-gen-country-us-session-rand1111 --password LUMINATI_PASSWORD --porxy 162.243.162.95 --country us --dns remote --max_requests 100 --session_timeout 50000 --www 22998 --resolve local_resolve.txt
```

or if you want to use socks proxy:

```sh
luminati-proxy --socks 25000:23000 --log DEBUG --customer LUMINATI_ACCOUNT --password LUMINATI_PASSWORD --zone gen --country us --proxy 162.243.162.95 --dns remote --max_requests 100 --session_timeout 50000 --resolve local_resolve.txt
```
