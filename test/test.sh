#!/usr/bin/env bash

localaddr="http://localhost:8787"
tmp_file=$(mktemp)
trap 'rm "$tmp_file"' EXIT

# declare colors
C_RESET='\x1b[0m'
C_RED='\x1b[0;37;31m'
C_GREEN='\x1b[0;37;32m'

die() {
    printf "${C_RED}%s${C_RESET}\n" "$@" >&2
    exit 1
}

err() {
   printf "${C_RED}%s${C_RESET}\n" "$@"
}

it() {
    num_tests=$((num_tests+1))
    printf "${C_GREEN}> it %s:${C_RESET} " "$1"
    shift
    echo "$@"
    "$@"
    exit_code=$?
    if [ "$exit_code" != 0 ]; then
        printf "${C_RED}But fails with error code %s${C_RESET}\n" "$exit_code"
    else
        num_passed=$((num_passed+1))
    fi
}

# run test but not counted
assert() {
    "$@"
    exit_code=$?
    if [ "$exit_code" != 0 ]; then
        printf "${C_RED}Command ‘$@’ failed with error code %s${C_RESET}\n" "$exit_code"
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
    if [ "$num_passed" != "$num_tests" ]; then
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
    assert curl_code 200 -o "$tmp_file" -Fc="$test_text" -Fp=true "$localaddr"
    url=$(jq -r '.url' "$tmp_file")
    path=${url##*/}
    it 'should return a long path' [ "${#path}" -gt 20 ]

    start_test "fetching paste"
    assert curl_code 200 -o "$tmp_file" "$url"
    it 'should return the original paste' [ "$(cat "$tmp_file")" = "$test_text" ]
}

_test_expire() {
    test_text="hello world"
    start_test "uploading paste"

    it 'should accept ‘100m’ expiration' curl_code 200 -o "$tmp_file" -Fc="$test_text" -Fe=100m "$localaddr"
    expire=$(jq -r '.expire' "$tmp_file")
    it 'should return a correct expire' [ "$expire" = 6000 ]

    it 'should accept ‘1000’ expiration' curl_code 200 -o "$tmp_file" -Fc="$test_text" -Fe=1000 "$localaddr"
    expire=$(jq -r '.expire' "$tmp_file")
    it 'should return a correct expire' [ "$expire" = 1000 ]

    it 'should accept ‘100 m’ expiration' curl_code 200 -o "$tmp_file" -Fc="$test_text" -Fe="100 m" "$localaddr"
    expire=$(jq -r '.expire' "$tmp_file")
    it 'should return a correct expire' [ "$expire" = 6000 ]

    it 'should reject illegal expiration' curl_code 400 -o "$tmp_file" -Fc="$test_text" -Fe=abc "$localaddr"
    it 'should reject illegal expiration' curl_code 400 -o "$tmp_file" -Fc="$test_text" -Fe=1c "$localaddr"
    it 'should reject illegal expiration' curl_code 400 -o "$tmp_file" -Fc="$test_text" -Fe=-100m "$localaddr"
}

_test_markdown() {
    test_text="#Hello"
    start_test "uploading paste"
    assert curl_code 200 -o "$tmp_file" -Fc="$test_text" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")

    start_test "fetching paste"
    url_with_u="$localaddr/a/${url##*/}"
    assert curl_code 200 -o "$tmp_file" "$url_with_u"
    cp $tmp_file ~/tmp/log
    it 'should return rendered paste' grep --silent --fixed-strings '<p>#Hello</p>' "$tmp_file"

    mimetype=$(assert curl -o /dev/null -sS -w '%{content_type}' "$url_with_u")
    it 'should return html mimetype' [ "$mimetype" = "text/html;charset=UTF-8" ]
}

_test_custom_path() {
    test_text="hello world"
    wrong_admin_url="this-is-a-wrong-admin-url"
    name="$RANDOM"'+_-[]*$@,;'
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

_test_content_disposition() {
    test_text="hello world"
    test_filename="hello.txt"

    inline_disp_prefix="inline; filename*=UTF-8''"
    att_disp_prefix="attachment; filename*=UTF-8''"

    assert curl_code 200 -o "$tmp_file" -Fc="$test_text" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")
    disp=$(curl -o /dev/null -sS -w '%header{content-disposition}' "$url")
    it 'should return ‘inline’ content-disposition for normal paste' [ "$disp" = "inline" ]

    disp=$(curl -o /dev/null -sS -w '%header{content-disposition}' "$url?a=")
    it 'should return ‘attachment’ content-disposition for normal paste' [ "$disp" = "attachment" ]

    assert curl_code 200 -o "$tmp_file" -Fc="$test_text;filename=hello.txt" "$localaddr"
    url=$(jq -r '.url' "$tmp_file")
    disp=$(curl -o /dev/null -sS -w '%header{content-disposition}' "$url")
    it 'should return filename for paste with filename' [ "$disp" = "${inline_disp_prefix}${test_filename}" ]

    alt_filename="world.txt"
    disp=$(curl -o /dev/null -sS -w '%header{content-disposition}' "$url/$alt_filename")
    it 'should return filename for paste with filename' [ "$disp" = "${inline_disp_prefix}${alt_filename}" ]
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
    it 'should make a redirect for '$url_with_u [ "$redirect_url" = "$test_text" ]
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
    mimetype=$(curl -o /dev/null -sS -w '%{content_type}' "$url/test.jpg")
    it 'should return recognize .jpg filename extension' [ "$mimetype" = 'image/jpeg;charset=UTF-8' ]
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

    mimetype=$(assert curl -o /dev/null -sS -w '%{content_type}' "$url?lang=html")
    it 'should return html mimetype' [ "$mimetype" = "text/html;charset=UTF-8" ]
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

pgrep -f workerd > /dev/null || die "no workerd is running, please start one instance with ‘yarn dev’"

if [ $# -gt 0 ]; then
    test_chapters "$@"
else
    test_chapters primary expire long_mode custom_path \
        markdown url_redirect content_disposition \
        mime highlight custom_passwd suggest
fi

conclude
