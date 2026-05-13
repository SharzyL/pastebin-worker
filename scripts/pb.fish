# fish-shell completions for pb
# See: https://github.com/SharzyL/pastebin-worker/tree/goshujin/scripts

set -l commands p post u update g get d delete

complete -c pb -f

# common_args:
complete -c pb -s d -l dry -d 'dry run'
complete -c pb -s v -l verbose -d 'verbose output'

# root_args:
complete -c pb -n "not __fish_seen_subcommand_from $commands" -s h -l help -d 'print help'
complete -c pb -n "not __fish_seen_subcommand_from $commands" -l base-url -x -d 'Base URL (overrides $PB_DOMAIN)'

# cmdlist:
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a post -d "Post paste"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a update -d "Update paste"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a get -d "Get paste"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a delete -d "Delete paste"

# case post:
# todo: - Read the paste from stdin
complete -c pb -n "__fish_seen_subcommand_from post p" -F
complete -c pb -n "__fish_seen_subcommand_from post p" -s c -l content -x -d 'Content of paste'
complete -c pb -n "__fish_seen_subcommand_from post p" -s e -l expire -x -d 'Expiration time'
complete -c pb -n "__fish_seen_subcommand_from post p" -s n -l name -x -d Name
complete -c pb -n "__fish_seen_subcommand_from post p" -s s -l password -x -d Password
complete -c pb -n "__fish_seen_subcommand_from post p" -s p -l private -f -d 'Make generated paste name longer for privacy'
complete -c pb -n "__fish_seen_subcommand_from post p" -s x -l clip -f -d 'Clip the url to the clipboard'

# case update:
complete -c pb -n "__fish_seen_subcommand_from update u" -s c -l content -x -d 'Content of paste'
complete -c pb -n "__fish_seen_subcommand_from update u" -s f -l file -r -d 'Read the paste from file'
complete -c pb -n "__fish_seen_subcommand_from update u" -s e -l expire -x -d 'Expiration time'
complete -c pb -n "__fish_seen_subcommand_from update u" -s s -l password -x -d Password
complete -c pb -n "__fish_seen_subcommand_from update u" -s x -l clip -f -d 'Clip the url to the clipboard'

# case get:
function __pb_hist_names
    set -l hist_file (test -n "$XDG_CONFIG_DIR"; and echo "$XDG_CONFIG_DIR/pb_hist"; or echo "$HOME/.config/pb_hist")
    test -r "$hist_file"; or return
    # latest-first, dedup keeping the most recent occurrence
    awk -F: 'NF { last[$1]=NR; name[NR]=$1 } END { for (i=NR; i>=1; i--) if (name[i] != "" && last[name[i]] == i) print name[i] }' "$hist_file"
end
complete -c pb -n "__fish_seen_subcommand_from get g" -s o -l output -r -d 'Output the paste in file'
complete -c pb -n "__fish_seen_subcommand_from get g" -s u -l url -f -d 'Make a 302 redirection'
complete -c pb -n "__fish_seen_subcommand_from get g" -l meta -f -d 'Fetch /m/<name> metadata as JSON'
complete -c pb -n "__fish_seen_subcommand_from get g" -f -a '(__pb_hist_names)' -d 'paste from history'
