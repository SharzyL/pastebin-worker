#!/bin/bash

localaddr="http://localhost:8787"
tmp_file=$(mktemp)
trap 'rm "$tmp_file"' EXIT

die() {
    echo "$@" >&2
    exit 1
}

err() {
	printf "\x1b[0;37;31m%s\x1b[0m\n" "$@"
}

it() {
    num_tests=$((num_tests+1))
    printf "\x1b[0;37;32m> it %s\x1b[0m: " "$1"
    shift
    echo "$@"
    "$@"
    exit_code=$?
    if [ "$exit_code" != 0 ]; then
        printf "\x1b[0;37;31mBut fails with error code %s\x1b[0m\n" "$exit_code"
    else
        num_passed=$((num_passed+1))
    fi
}

curl_code() {  # a wrapper of curl that checks status code
    expected_status_code="$1"
    shift
    status_code=$(curl -sS -w '%{response_code}' "$@" -o /dev/null) || return 1
    if [ "$status_code" != "$expected_status_code" ]; then
    	err "status code $status_code, expected $expected_status_code"
    	return 1
	fi
}

start_test() {
    printf "\x1b[0;37;34mStart testing %s\x1b[0m\n" "$*"
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

test_chapters() {
    for i in "$@"; do
        echo "---------------------"
        printf "\x1b[0;97m%s\x1b[0m\n" "$i"
        echo "---------------------"
        "_test_${i}"
    done
}

_test_primary() {
    test_text="hello world"
    wrong_admin_url="this-is-a-wrong-admin-url"

    start_test "uploading paste"
    it 'should upload paste' curl_code 200 -o "$tmp_file" -Fc="$test_text" "$localaddr"

    url=$(jq -r '.url' "$tmp_file")
    admin_url=$(jq -r '.admin' "$tmp_file")

    start_test "fetching paste"
    it 'should fetch paste' curl_code 200 -o "$tmp_file" "$url"
    it 'should return the original pas\e' [ "$(cat "$tmp_file")" = "$test_text" ]

    start_test "fetching non-existing paste"
    it 'should return 404 for non-existing paste' curl_code 404 -o /dev/null "$localaddr/$wrong_admin_url"

    start_test "updating paste"
    new_text="Hello new world"
    it 'should return 403 for wrong passwd' curl_code 403 -o /dev/null -X PUT -Fc="$new_text" "$url:$wrong_admin_url"
    it 'should return 200 for true passwd' curl_code 200 -o /dev/null -X PUT -Fc="$new_text" "$admin_url"
    curl_code 200 -o "$tmp_file" "$url"
    it 'should return the updated paste' [ "$(cat "$tmp_file")" = "$new_text" ]

    start_test "deleting paste"
    it 'should return 403 for wrong passwd' curl_code 403 -o /dev/null -X DELETE "$url:$wrong_admin_url"
    it 'should return 200 for true passwd' curl_code 200 -o /dev/null -X DELETE "$admin_url"
    it 'should delete the paste' curl_code 404 -o /dev/null "$url"
}

_test_long_mode() {
    test_text="hello world"
    start_test "uploading paste"
    it 'should upload paste' curl_code 200 -o "$tmp_file" -Fc="$test_text" -Fp=true "$localaddr"
    url=$(jq -r '.url' "$tmp_file")
    path=${url##*/}
    it 'should return a long path' [ "${#path}" -gt 20 ]

    start_test "fetching paste"
    it 'should fetch paste' curl_code 200 -o "$tmp_file" "$url"
    it 'should return the original pas\e' [ "$(cat "$tmp_file")" = "$test_text" ]
}

_test_custom_path() {
    test_text="hello world"
    wrong_admin_url="this-is-a-wrong-admin-url"
    name="$RANDOM"'+_-[]*$=@,;/'
    bad_names=("a" "ab" "...")

    start_test "uploading paste of bad name"
    for bad_name in "${bad_names[@]}"; do
		it 'should upload paste' curl_code 400 -o "$tmp_file" -Fc="$test_text" -Fn="$bad_name" "$localaddr"
	done

    start_test "uploading paste"
    it 'should upload paste' curl_code 200 -o "$tmp_file" -Fc="$test_text" -Fn="\"$name\"" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")
    admin_url=$(jq -r '.admin' "$tmp_file")
    it 'should give the custom path' [ "$url" == "$localaddr/~$name" ]

    start_test "fetching paste"
    it 'should fetch paste' curl_code 200 -o "$tmp_file" "$url"
    it 'should return the original paste' [ "$(cat "$tmp_file")" = "$test_text" ]

    start_test "updating paste"
    new_text="Hello new world"
    it 'should return 403 for wrong passwd' curl_code 403 -o /dev/null -X PUT -Fc="$new_text" "$url:$wrong_admin_url"
    it 'should return 200 for true passwd' curl_code 200 -o /dev/null -X PUT -Fc="$new_text" "$admin_url"
    curl_code 200 -o "$tmp_file" "$url"
    it 'should return the updated paste' [ "$(cat "$tmp_file")" = "$new_text" ]

    start_test "deleting paste"
    it 'should return 403 for wrong passwd' curl_code 403 -o /dev/null -X DELETE "$url:$wrong_admin_url"
    it 'should return 200 for true passwd' curl_code 200 -o /dev/null -X DELETE "$admin_url"
    it 'should delete the paste' curl_code 404 -o /dev/null "$url"
}

_test_custom_passwd() {
    test_text="hello world"
    wrong_admin_url="this-is-a-wrong-admin-url"
    name="$RANDOM"
    passwd="$RANDOM$RANDOM"

    start_test "uploading paste"
    it 'should upload paste' curl_code 200 -o "$tmp_file" -Fc="$test_text" -Fn="$name" -Fs="$passwd" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")
    admin_url=$(jq -r '.admin' "$tmp_file")
    path=${url##*/}
    admin_path=${admin_url##*/}
    it 'should give the custom path' [ "$path" = "~$name" ]
    it 'should give the custom passwd' [ "$admin_path" = "~$name:$passwd" ]

    start_test "fetching paste"
    it 'should fetch paste' curl_code 200 -o "$tmp_file" "$url"
    it 'should return the original paste' [ "$(cat "$tmp_file")" = "$test_text" ]

    start_test "updating paste"
    new_text="Hello new world"
    it 'should return 403 for wrong passwd' curl_code 403 -o /dev/null -X PUT -Fc="$new_text" "$url:$wrong_admin_url"
    it 'should return 200 for true passwd' curl_code 200 -o /dev/null -X PUT -Fc="$new_text" "$admin_url"
    curl_code 200 -o "$tmp_file" "$url"
    it 'should return the updated paste' [ "$(cat "$tmp_file")" = "$new_text" ]

    start_test "deleting paste"
    it 'should return 403 for wrong passwd' curl_code 403 -o /dev/null -X DELETE "$url:$wrong_admin_url"
    it 'should return 200 for true passwd' curl_code 200 -o /dev/null -X DELETE "$admin_url"
    it 'should delete the paste' curl_code 404 -o /dev/null "$url"
}

_test_url_redirect() {
    test_text="https://sharzy.in/"

    start_test "uploading paste"
    it 'should upload paste' curl_code 200 -o "$tmp_file" -Fc="$test_text" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")

    start_test "URL redirect"
    url_with_u="$localaddr/u/${url##*/}"
    redirect_url=$(curl -o /dev/null -sS -w '%{redirect_url}' "$url_with_u")
    it 'should make a redirect' [ "$redirect_url" = "$test_text" ]
}

_test_mime() {
    test_text="hello world"

    start_test "uploading paste"
    it 'should upload paste' curl_code 200 -o "$tmp_file" -Fc="$test_text" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")

    start_test "mimetype"
    mimetype=$(curl -o /dev/null -sS -w '%{content_type}' "$url")
    it 'should return text/plain for normal fetch' [ "$mimetype" = 'text/plain;charset=UTF-8' ]
    mimetype=$(curl -o /dev/null -sS -w '%{content_type}' "$url.jpg")
    it 'should return recognize .jpg extension' [ "$mimetype" = 'image/jpeg;charset=UTF-8' ]
    mimetype=$(curl -o /dev/null -sS -w '%{content_type}' "$url?mime=random-mime")
    it 'should know "mime" query string' [ "$mimetype" = 'random-mime;charset=UTF-8' ]
}

_test_highlight() {
    test_text="hello world"

    start_test "uploading paste"
    it 'should upload paste' curl_code 200 -o "$tmp_file" -Fc="$test_text" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")

    start_test "language highlight"
    curl -o "$tmp_file" -sS "$url?lang=html"
    it 'should return a language highlight powered by prismjs' \
        grep -q 'language-html' "$tmp_file"
}

_test_suggest() {
  url_text="http://example.com/a?x=y"
  non_url_text="if (x = 1) x++"
  it 'should upload url paste' curl_code 200 -o "$tmp_file" -Fc="$url_text" "$localaddr"
  it 'should suggest /u/ url' grep -q '"suggestUrl": .*/u/' "$tmp_file"
  it 'should upload non-url paste' curl_code 200 -o "$tmp_file" -Fc="$non_url_text" "$localaddr"
  it 'should not contain suggestUrl' grep -q '"suggestUrl": null' "$tmp_file"

  tmp_jpg_file="$(mktemp --suffix .jpg)"
  echo "guruguruguruguru" >"$tmp_jpg_file"
  it 'should upload non-url paste' curl_code 200 -o "$tmp_file" -Fc=@"$tmp_jpg_file" "$localaddr"
  it 'should suggest .jpg url' grep -q '"suggestUrl": .*\.jpg' "$tmp_file"
}

pgrep -f miniflare > /dev/null || die "no miniflare is running, please start one instance first"

if [ $# -gt 0 ]; then
    test_chapters "$@"
else
    test_chapters primary long_mode custom_path url_redirect mime highlight custom_passwd suggest
fi

conclude
