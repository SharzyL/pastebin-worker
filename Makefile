CONF = config.json
BUILD_DIR = dist
JS_DIR = src

target_html_files = index.html tos.html

# script path
html_renderer = node scripts/render.js -c $(CONF)
md2html = scripts/md2html.sh
deploy = scripts/deploy-static.sh

# stub directories to record when files are uploaded
DEPLOY_DIR = dist/deploy
PREVIEW_DIR = dist/preview

source_js_files = $(wildcard $(JS_DIR)/*.js)
all_html = $(addprefix $(BUILD_DIR)/,$(target_html_files))
all_html_deploy = $(addprefix $(DEPLOY_DIR)/, $(target_html_files))
all_html_preview = $(addprefix $(PREVIEW_DIR)/, $(target_html_files))
js_deploy = $(addprefix $(DEPLOY_DIR)/, $(target_js_file))
js_preview = $(addprefix $(PREVIEW_DIR)/, $(target_js_file))

html: $(all_html)

test:
	./test/test.sh

deploy: $(all_html_deploy) $(js_deploy)

preview: $(all_html_preview) $(js_preview)

clean:
	rm -f $(all_html) $(all_html_deploy) $(all_html_preview) $(js_deploy) $(js_preview)

$(BUILD_DIR)/tos.html.liquid: static/tos.md $(md2html)
	$(md2html) $< $@ "Terms and Conditions"

$(BUILD_DIR)/index.html.liquid: static/index.html
	@# no generation needed, simply copy
	cp $< $@

# convert liquid template to html file
$(all_html): $(BUILD_DIR)/%.html: $(BUILD_DIR)/%.html.liquid $(CONF)
	$(html_renderer) -o $@ $<
	@# remove indents to reduce size
	sed -E -i 's/^\s+//g' $@

# deploy html file to Cloudflare
$(all_html_deploy): $(DEPLOY_DIR)/%.html: $(BUILD_DIR)/%.html
	$(deploy) $<
	@mkdir -p $(dir $@)
	@touch $@

# deploy html file to Cloudflare preview
$(all_html_preview): $(PREVIEW_DIR)/%.html: $(BUILD_DIR)/%.html
	$(deploy) --preview $^
	@mkdir -p $(dir $@)
	@touch $@

# because wrangler will always build before publish, we cannot do cache here
$(js_deploy): $(source_js_files)
	wrangler publish
	@mkdir -p $(dir $@)
	@touch $@

.PHONY: html test deploy preview clean
