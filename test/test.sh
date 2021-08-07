#!/bin/sh

localaddr="http://localhost:8787"

declare -i num_tests
declare -i num_passed

die() {
    echo $@ >&2
    exit 1
}

it() {
    num_tests=num_tests+1
    printf "\x1b[0;37;32m> it $1\x1b[0m: "
    shift
    echo "$@"
    return_val=$("$@")
    exit_code=$?
    if [ "$exit_code" != 0 ]; then
        printf "\x1b[0;37;31mBut fails with error code $exit_code\x1b[0m\n"
    else
        num_passed=num_passed+1
    fi
}

curl_should_return_status_code() {
    num_tests=num_tests+1
    printf "\x1b[0;37;32m> it should return status code $1\x1b[0m: "
    expected_status_code="$1"
    shift
    echo curl $@
    status_code=$(curl -sS -w '%{response_code}' "$@")
    if [ "$status_code" != "$expected_status_code" ]; then
        printf "\x1b[0;37;31mBut fails with status code $status_code\x1b[0m\n"
    else
        num_passed=num_passed+1
    fi
}

start_test() {
    printf "\x1b[0;37;34mStart testing $@\x1b[0m\n"
}

conclude() {
    echo '------------------------'
    echo "$num_passed / $num_tests tests passed"
    echo '------------------------'
    if [ $num_passed != $num_tests ]; then
        exit 1
    else
        exit 0
    fi
}

main() {
    test_text="Hello world"
    tmp_file=$(mktemp)


    start_test "uploading paste"
    curl_should_return_status_code 200 -o "$tmp_file" -Fc="$test_text" "$localaddr" 

    url=$(jq '.url' "$tmp_file" | tr -d '"')
    admin_url=$(jq '.admin' "$tmp_file" | tr -d '"')


    start_test "fetching paste"
    curl_should_return_status_code 200 -o "$tmp_file" "$url"
    it 'should return the original paste' \
        [ "$(cat $tmp_file)" = "$test_text" ]


    start_test "fetching unexisting paste"
    curl_should_return_status_code 404 -o /dev/null "$localaddr/hahaha" 


    start_test "updating paste"
    new_text="Hello new world"
    curl_should_return_status_code 200 -o /dev/null -X PUT -Fc="$new_text" "$admin_url"
    curl_should_return_status_code 200 -o "$tmp_file" "$url"
    it 'should return the updated paste' \
        [ "$(cat $tmp_file)" = "$new_text" ]


    start_test "deleting paste"
    curl_should_return_status_code 200 -o /dev/null -X DELETE "$admin_url"
    curl_should_return_status_code 404 -o /dev/null "$url"
}

pgrep -f miniflare > /dev/null || die "no miniflare is running, please start one instance first"

main
conclude
