# this Makefile manages the generation and deployment of static pages

CONF = config.json
BUILD_DIR = dist

target_html_files = index.html tos.html

# stub directories to record when files are uploaded
DEPLOY_DIR = dist/deploy
PREVIEW_DIR = dist/preview

all_dist = $(addprefix $(BUILD_DIR)/,$(target_html_files))
all_deploy = $(addprefix $(DEPLOY_DIR)/, $(target_html_files))
all_preview = $(addprefix $(PREVIEW_DIR)/, $(target_html_files))

# script path
html_renderer = node scripts/render.js -c $(CONF)
md2html = scripts/md2html.sh
deploy = scripts/deploy-static.sh

all: $(all_dist)

test:
	./test/test.sh

deploy: $(all_deploy)

preview: $(all_preview)

clean:
	rm -f $(all_dist)

$(BUILD_DIR)/tos.html.liquid: static/tos.md
	$(md2html) $^ $@ "Terms and Conditions"

$(BUILD_DIR)/index.html.liquid: static/index.html.liquid
	# no generation needed, simply copy
	cp $^ $@

# convert liquid template to html file
$(all_dist): $(BUILD_DIR)/%.html: $(BUILD_DIR)/%.html.liquid
	$(html_renderer) -o $@ $^
	# remove indents to reduce size
	sed -E -i 's/^\s+//g' $@

# deploy html file to Cloudflare
$(all_deploy): $(DEPLOY_DIR)/%.html: $(BUILD_DIR)/%.html
	$(deploy) $^
	@mkdir -p $(dir $@)
	@touch $@

# deploy html file to Cloudflare preview
$(all_preview): $(PREVIEW_DIR)/%.html: $(BUILD_DIR)/%.html
	$(deploy) $^
	@mkdir -p $(dir $@)
	@touch $@

.PHONY: all test deploy preview clean
