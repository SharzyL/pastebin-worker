# fish-shell completions for pb
# See: https://github.com/SharzyL/pastebin-worker/tree/goshujin/scripts

set -l commands p post u update g get d delete l list history

complete -c pb -f

# common args (accepted at any position: before or after the action)
complete -c pb -s d -l dry -d 'dry run'
complete -c pb -s v -l verbose -d 'verbose output'
complete -c pb -s h -l help -d 'print help'
complete -c pb -l base-url -x -d 'Base URL (overrides $PB_DOMAIN)'

# cmdlist:
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a post -d "Post paste"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a update -d "Update paste"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a get -d "Get paste"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a delete -d "Delete paste"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a list -d "List pastes from history"
complete -c pb -n "not __fish_seen_subcommand_from $commands" -a history -d "Maintain the history file"

# case post:
# todo: - Read the paste from stdin
complete -c pb -n "__fish_seen_subcommand_from post p" -F
complete -c pb -n "__fish_seen_subcommand_from post p" -s c -l content -x -d 'Content of paste'
complete -c pb -n "__fish_seen_subcommand_from post p" -s e -l expire -x -d 'Expiration time'
complete -c pb -n "__fish_seen_subcommand_from post p" -s n -l name -x -d Name
complete -c pb -n "__fish_seen_subcommand_from post p" -s s -l password -x -d Password
complete -c pb -n "__fish_seen_subcommand_from post p" -s p -l private -f -d 'Make generated paste name longer for privacy'
complete -c pb -n "__fish_seen_subcommand_from post p" -s x -l clip -f -d 'Clip the url to the clipboard'
complete -c pb -n "__fish_seen_subcommand_from post p" -s u -l unencrypted -f -d 'Upload without client-side encryption'
complete -c pb -n "__fish_seen_subcommand_from post p" -s E -l encrypt -f -d 'Client-side AES-GCM encryption (default)'
complete -c pb -n "__fish_seen_subcommand_from post p" -s F -l filename -x -d 'Filename to store with paste'

# case update:
complete -c pb -n "__fish_seen_subcommand_from update u" -s c -l content -x -d 'Content of paste'
complete -c pb -n "__fish_seen_subcommand_from update u" -s f -l file -r -d 'Read the paste from file'
complete -c pb -n "__fish_seen_subcommand_from update u" -s e -l expire -x -d 'Expiration time'
complete -c pb -n "__fish_seen_subcommand_from update u" -s s -l password -x -d Password
complete -c pb -n "__fish_seen_subcommand_from update u" -s x -l clip -f -d 'Clip the url to the clipboard'
complete -c pb -n "__fish_seen_subcommand_from update u" -s u -l unencrypted -f -d 'Upload without client-side encryption'
complete -c pb -n "__fish_seen_subcommand_from update u" -s E -l encrypt -f -d 'Client-side AES-GCM encryption (default)'
complete -c pb -n "__fish_seen_subcommand_from update u" -s F -l filename -x -d 'Filename to store with paste'

# case get:
function __pb_hist_names
    # names of the pastes in pb's history, latest first, on the endpoint
    # given by --base-url or $PB_DOMAIN
    set -l tokens (commandline -opc)
    set -l base_args
    if set -l i (contains -i -- --base-url $tokens); and test (count $tokens) -gt $i
        set base_args --base-url $tokens[(math $i + 1)]
    end
    pb list --names $base_args 2>/dev/null
end
complete -c pb -n "__fish_seen_subcommand_from get g" -s o -l output -r -d 'Output the paste in file'
complete -c pb -n "__fish_seen_subcommand_from get g" -s u -l url -f -d 'Make a 302 redirection'
complete -c pb -n "__fish_seen_subcommand_from get g" -l meta -f -d 'Fetch /m/<name> metadata as JSON'
complete -c pb -n "__fish_seen_subcommand_from get g" -s K -l key -x -d 'Decryption key (overrides history)'
complete -c pb -n "__fish_seen_subcommand_from get g" -l no-decrypt -f -d 'Do not decrypt encrypted pastes'
complete -c pb -n "__fish_seen_subcommand_from get g" -l save -r -d 'Save under DIR using server filename'
complete -c pb -n "__fish_seen_subcommand_from get g" -s f -l force -f -d 'Overwrite existing file without prompting'
complete -c pb -n "__fish_seen_subcommand_from get g" -f -k -a '(__pb_hist_names)' -d 'paste from history'
complete -c pb -n "__fish_seen_subcommand_from update u delete d" -f -k -a '(__pb_hist_names)' -d 'paste from history'

# case list:
complete -c pb -n "__fish_seen_subcommand_from list l" -s a -l all -d 'Include deleted and expired pastes'
complete -c pb -n "__fish_seen_subcommand_from list l" -l all-endpoints -d 'Include pastes on other endpoints'
complete -c pb -n "__fish_seen_subcommand_from list l" -l json -d 'Print one JSON object per paste'
complete -c pb -n "__fish_seen_subcommand_from list l" -l names -d 'Print paste names only'

# case history:
complete -c pb -n "__fish_seen_subcommand_from history; and not __fish_seen_subcommand_from migrate prune" -a migrate -d 'Import the old history file'
complete -c pb -n "__fish_seen_subcommand_from history; and not __fish_seen_subcommand_from migrate prune" -a prune -d 'Drop deleted and expired pastes'
complete -c pb -n "__fish_seen_subcommand_from migrate" -F
