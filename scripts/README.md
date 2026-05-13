# Scripts of pastebin-worker

This directory contains a set of scripts that facilitate the usage and development of pastebin-worker.

## `pb`: paste things on command line

This is a wrapper script to make it easier to use our pastebin.

**Requirements**: `python3` (>=3.9) with the `requests` package available

**Installation**: download `pb` to your `PATH` and give it execution permission. For example:

```shell
$ wget https://github.com/SharzyL/pastebin-worker/raw/goshujin/scripts/pb
$ install -Dm755 pb ~/.local/bin
```

By default the script will use the instance on `https://shz.al`, you can either modify the script itself, or specify the `PB_DOMAIN` environment variable to use other instances.

**Zsh completion**: download `_pb` in a folder within your zsh `fpath`

**fish completion**: download `pb.fish` in a folder within your fish `fish_complete_path`

**Usage**:

```text
$ pb -h
Usage:
  pb [-h|--help]
    print this help message

  pb [p|post] [OPTIONS]
    upload your text to pastebin, if neither '-f FILE' nor '-c CONTENT' are
    given, read the paste from stdin.

  pb [u|update] [OPTIONS] NAME[:PASSWD]
    Update your text to pastebin, if neither '-f FILE' nor '-c CONTENT' are
    given, read the paste from stdin. If 'PASSWD' is not given, try to read
    password from the history file.

  pb [g|get] [OPTIONS] NAME[.EXT]
    fetch the paste with name 'NAME' and extension 'EXT'

  pb [d|delete] [OPTIONS] NAME[:PASSWD]
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
    -o, --output FILE       output the paste in file 'FILE'
    -u, --url               make a 302 URL redirection
    --meta                  fetch /m/<name> metadata as pretty JSON

  delete options:
    none

  general options:
    -v, --verbose           log the planned request (method, URL, fields)
    -d, --dry               do a dry run, sending no HTTP request at all
```
