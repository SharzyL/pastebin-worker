# `pb.sh`: paste everything easily

This is a wrapper script to make it easier to use our pastebin. 

**Installation**: download `pb` to your `PATH` and give it execution permission. For example: 

```shell
$ wget https://github.com/SharzyL/pastebin-worker/raw/master/scripts/pb
$ install -Dm755 pb ~/.local/bin
```

**Usage**: 

```shell
$ pb -h
Usage:
  pb.sh [-h|--help]
    print this help message

  pb.sh [p|post] [OPTIONS] [-f] FILE
    upload your text to pastebin, if neither 'FILE' and 'CONTENT' are given,
    read the paste from stdin.

  pb.sh [u|update] NAME[:PASSWD]
    Update your text to pastebin, if neither 'FILE' and 'CONTENT' are given,
    read the paste from stdin. If 'PASSWD' is not given, try to read password
    from the history file.

  pb.sh [g|get] [OPTIONS] NAME[.EXT]
    fetch the paste with name 'NAME' and extension 'EXT'

  pb.sh [d|delete] [OPTIONS] NAME
    delete the paste with name 'NAME'

Options:
  post options:
    -c, --content CONTENT   the content of the paste
    -e, --expire SECONDS    the expiration time of the paste (in seconds)
    -n, --name NAME         the name of the paste
    -s, --passwd PASSWD     the password
    -h, --human             return a human-friendly web page
    -p, --private           make the generated paste name longer for better privacy
    -x, --clip              clip the url to the clipboard

  update options:
    -f, --file FILE         read the paste from file
    -c, --content CONTENT   the content of the paste
    -e, --expire SECONDS    the expiration time of the paste (in seconds)
    -s, --passwd PASSWD     the password
    -h, --human             return a human-friendly web page
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

