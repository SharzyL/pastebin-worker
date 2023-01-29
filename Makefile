CONF = config.json
CONF_PREVIEW = config.preview.json
BUILD_DIR = dist
JS_DIR = src
JS_LOCK = yarn.lock

target_html_files = index.html tos.html

# script path
html_render_script = scripts/render.js
md2html = scripts/md2html.sh
deploy_static_script = scripts/deploy-static.sh

# stub directories to record when files are uploaded
RENDERED_DIR = dist/rendered
RENDERED_PREVIEW_DIR = dist/rendered_preview
DEPLOY_DIR = dist/preview
DEPLOY_PREVIEW_DIR = dist/deploy_preview

rendered_html = $(addprefix $(RENDERED_DIR)/,$(target_html_files))
rendered_preview_html = $(addprefix $(RENDERED_PREVIEW_DIR)/,$(target_html_files))
deploy_html = $(addprefix $(DEPLOY_DIR)/, $(target_html_files))
deploy_preview_html = $(addprefix $(DEPLOY_PREVIEW_DIR)/, $(target_html_files))

html: $(all_html)

test:
	./test/test.sh

deploy: $(deploy_html) $(source_js_files) $(JS_LOCK)
	yarn wrangler publish

preview: $(deploy_preview_html) $(source_js_files) $(JS_LOCK)
	yarn wrangler publish --env preview

clean:
	rm -f $(all_html) $(all_html_deploy) $(all_html_preview) $(js_deploy) $(js_preview)

$(BUILD_DIR)/tos.html.liquid: frontend/tos.md $(md2html)
	mkdir -p $(BUILD_DIR)
	$(md2html) $< $@ "Terms and Conditions"

$(BUILD_DIR)/index.html.liquid: frontend/index.html frontend/index.js frontend/style.css
	@# no generation needed, simply copy
	mkdir -p $(BUILD_DIR)
	cp $< $@

# convert liquid template to html file
$(rendered_html): $(RENDERED_DIR)/%.html: $(BUILD_DIR)/%.html.liquid $(CONF) $(html_render_script)
	mkdir -p $(dir $@)
	node $(html_render_script) -c $(CONF)  -o $@ $<
	@# remove indents to reduce size
	perl -pi -e 's/^\s+//g' $@

# convert liquid template to html file
$(rendered_preview_html): $(RENDERED_PREVIEW_DIR)/%.html: $(BUILD_DIR)/%.html.liquid $(CONF_PREVIEW) $(html_render_script)
	mkdir -p $(dir $@)
	node $(html_render_script) -c $(CONF_PREVIEW)  -o $@ $<
	@# remove indents to reduce size
	perl -pi -e 's/^\s+//g' $@

# deploy html file to Cloudflare
$(deploy_html): $(DEPLOY_DIR)/%.html: $(RENDERED_DIR)/%.html $(deploy_static_script)
	$(deploy_static_script) $<
	@mkdir -p $(dir $@)
	@touch $@

# deploy html file to Cloudflare preview env
$(deploy_preview_html): $(DEPLOY_PREVIEW_DIR)/%.html: $(RENDERED_PREVIEW_DIR)/%.html $(deploy_static_script)
	$(deploy_static_script) --preview $<
	@mkdir -p $(dir $@)
	@touch $@

.PHONY: html test deploy preview clean
