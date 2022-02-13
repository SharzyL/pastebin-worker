# Scripts of pastebin-worker

This directory contains a set of scripts that facilitate the usage and development of pastebin-worker. 

## `pb`: paste things on command line

This is a wrapper script to make it easier to use our pastebin. 

**Requirements**: `bash`, `jq`, `getopt`, `curl`

**Installation**: download `pb` to your `PATH` and give it execution permission. For example: 

```shell
$ wget https://github.com/SharzyL/pastebin-worker/raw/master/scripts/pb
$ install -Dm755 pb ~/.local/bin
```

**Zsh completion**: download `_pb` in a folder within your zsh `fpath` 

**fish completion**: download `pb.fish` in a folder within your fish `fish_complete_path` 

**Usage**: 

```text
$ pb -h
Usage:
  pb [-h|--help]
    print this help message

  pb [p|post] [OPTIONS] [-f] FILE
    upload your text to pastebin, if neither 'FILE' and 'CONTENT' are given,
    read the paste from stdin.

  pb [u|update] NAME[:PASSWD]
    Update your text to pastebin, if neither 'FILE' and 'CONTENT' are given,
    read the paste from stdin. If 'PASSWD' is not given, try to read password
    from the history file.

  pb [g|get] [OPTIONS] NAME[.EXT]
    fetch the paste with name 'NAME' and extension 'EXT'

  pb [d|delete] [OPTIONS] NAME
    delete the paste with name 'NAME'

Options:
  post options:
    -c, --content CONTENT   the content of the paste
    -e, --expire SECONDS    the expiration time of the paste (in seconds)
    -n, --name NAME         the name of the paste
    -s, --passwd PASSWD     the password
    -p, --private           make the generated paste name longer for better privacy
    -x, --clip              clip the url to the clipboard

  update options:
    -f, --file FILE         read the paste from file
    -c, --content CONTENT   the content of the paste
    -e, --expire SECONDS    the expiration time of the paste (in seconds)
    -s, --passwd PASSWD     the password
    -x, --clip              clip the url to the clipboard

  get options:
    -l, --lang LANG         highlight the paste with language 'LANG' in a web page
    -m, --mime MIME         set the 'Content-Type' header according to mime-type MIME
    -o, --output FILE       output the paste in file 'FILE'
    -u, --url               make a 301 URL redirection

  delete options:
    none

  general options:
    -v, --verbose           display the 'underlying' curl command
    -d, --dry               do a dry run, executing no 'curl' command at all
```

## `deploy-static.sh`

Deploy html files to Cloudflare KV storage. The map of KV storage key and web page is recorded in `src/staticPages.js`. Usage: 

```shell
deploy-static.sh [--preview] [<file-name>...]
```

## `md2html.sh`

Convert markdown to HTML, with a GitHub style CSS. Usage: 

```shell
md2html.sh <markdown-file> <html-file> <page-title>
```

## `post-commit`

A git hook that deploy the code after each commit on `master` branch. 

## `render.js`

A wrapper to render [LiquidJS](https://liquidjs.com) template file. 
