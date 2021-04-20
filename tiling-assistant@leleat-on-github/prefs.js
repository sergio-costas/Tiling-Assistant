"use strict";

const {Gdk, Gio, GLib, Gtk, GObject} = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const shellVersion = parseFloat(imports.misc.config.PACKAGE_VERSION);

const TILING = { // keybindings
	DEBUGGING: "debugging-show-tiled-rects",
	DEBUGGING_FREE_RECTS: "debugging-free-rects",
	TOGGLE_POPUP: "toggle-tiling-popup",
	AUTO: "auto-tile",
	MAXIMIZE: "tile-maximize",
	EDIT_MODE: "tile-edit-mode",
	LAYOUTS_OVERVIEW: "layouts-overview",
	RIGHT: "tile-right-half",
	LEFT: "tile-left-half",
	TOP: "tile-top-half",
	BOTTOM: "tile-bottom-half",
	TOP_LEFT: "tile-topleft-quarter",
	TOP_RIGHT: "tile-topright-quarter",
	BOTTOM_LEFT: "tile-bottomleft-quarter",
	BOTTOM_RIGHT: "tile-bottomright-quarter"
};

function init() {
};

function buildPrefsWidget() {
	const widget = new MyPrefsWidget();
	shellVersion < 40 && widget.show_all();
	return widget;
};

const MyPrefsWidget = new GObject.Class({
	Name : "TilingAssistantPrefsWidget",
	GTypeName : "TilingAssistantPrefsWidget",
	Extends : Gtk.ScrolledWindow,

	_init: function(params) {
		const gschema = Gio.SettingsSchemaSource.new_from_directory(
			Me.dir.get_child("schemas").get_path()
			, Gio.SettingsSchemaSource.get_default()
			, false
		);

		const settingsSchema = gschema.lookup("org.gnome.shell.extensions.tiling-assistant", true);
		this.settings = new Gio.Settings({settings_schema: settingsSchema});

		this.parent(params);

		this.builder = new Gtk.Builder();
		this.builder.add_from_file(Me.path + `/prefs${shellVersion < 40 ? "" : "40"}.ui`);
		const mainPrefs = this.builder.get_object("main_prefs");
		_addChildTo(this, mainPrefs);

		this.set_min_content_width(650);
		this.set_min_content_height(650);

		this._setupLayouts();
		this._setupPieMenu();

		this._bindWidgetsToSettings(settingsSchema.list_keys());
		this._bindWidgetsTogether();
		this._bindKeybindings();

		this.connect("destroy", () => this.settings.run_dispose());
	},

	// widgets in prefs.ui need to have same ID as the keys in the gschema.xml file
	_bindWidgetsToSettings: function(settingsKeys) {
		const ints = ["window-gap", "toggle-maximize-tophalf-timer", "vertical-preview-area", "horizontal-preview-area"
				, "pie-menu-deadzone-radius", "pie-menu-item-radius"];
		const bools = ["enable-tiling-popup", "enable-dynamic-tiling", "enable-tile-animations", "enable-untile-animations"
				, "enable-raise-tile-group", "enable-hold-maximize-inverse-landscape", "enable-hold-maximize-inverse-portrait"
				, "enable-pie-menu", "maximize-with-gap"];
		const enums = ["restore-window-size-on"];
		const colors = ["tile-editing-mode-color"];
		
		const getBindProperty = function(key) {
			if (ints.includes(key))
				return "value"; // Gtk.Spinbox.value
			else if (bools.includes(key))
				return "active"; //  Gtk.Switch.active
			else
				return null;
		}

		// int & bool settings
		settingsKeys.forEach(key => {
			const bindProperty = getBindProperty(key);
			const widget = this.builder.get_object(key);
			if (widget && bindProperty)
				this.settings.bind(key, widget, bindProperty, Gio.SettingsBindFlags.DEFAULT);
		});

		// enum settings
		enums.forEach(key => {
			const widget = this.builder.get_object(key);
			widget.set_active(this.settings.get_enum(key));
			widget.connect("changed", src => this.settings.set_enum(key, widget.get_active()));
		});

		// color buttons settings
		colors.forEach(key => {
			const widget = this.builder.get_object(key);
			const color = new Gdk.RGBA();
			color.parse(this.settings.get_string(key));
			widget.set_rgba(color);
			widget.connect("color-set", w => this.settings.set_string(key, w.get_rgba().to_string()));
		});
	},

	_bindWidgetsTogether: function() {
		const pieMenuToggle = this.builder.get_object("enable-pie-menu");
		const pieDisabled = pieMenuToggle.get_active();

		const deadzoneRow = this.builder.get_object("pie-menu-deadzone-listboxrow");
		deadzoneRow.set_sensitive(pieDisabled);
		pieMenuToggle.bind_property("active", deadzoneRow, "sensitive", GObject.BindingFlags.DEFAULT);

		const itemRadiusRow = this.builder.get_object("pie-menu-item-radius-listboxrow");
		itemRadiusRow.set_sensitive(pieDisabled);
		pieMenuToggle.bind_property("active", itemRadiusRow, "sensitive", GObject.BindingFlags.DEFAULT);
	},

	_bindKeybindings: function() {
		const shortcuts = Object.values(TILING);
		shortcuts.forEach(sc => this._makeShortcutEdit(sc));
	},

	// taken from Overview-Improved by human.experience
	// https://extensions.gnome.org/extension/2802/overview-improved/
	_makeShortcutEdit: function(settingKey, treeView, listStore) {
		const COLUMN_KEY = 0;
		const COLUMN_MODS = 1;

		const view = treeView || this.builder.get_object(settingKey + "-treeview");
		const store = listStore || this.builder.get_object(settingKey + "-liststore");
		const iter = store.append();
		const renderer = new Gtk.CellRendererAccel({xalign: 1, editable: true});
		const column = new Gtk.TreeViewColumn();
		column.pack_start(renderer, true);
		column.add_attribute(renderer, "accel-key", COLUMN_KEY);
		column.add_attribute(renderer, "accel-mods", COLUMN_MODS);
		view.append_column(column);

		const updateShortcutRow = (accel) => {
			// compatibility GNOME 40: GTK4's func returns 3 values / GTK3's only 2
			const array = accel ? Gtk.accelerator_parse(accel) : [0, 0];
			const [key, mods] = [array[array.length - 2], array[array.length - 1]];
			store.set(iter, [COLUMN_KEY, COLUMN_MODS], [key, mods]);
		};

		renderer.connect("accel-edited", (renderer, path, key, mods, hwCode) => {
			const accel = Gtk.accelerator_name(key, mods);
			updateShortcutRow(accel);
			this.settings.set_strv(settingKey, [accel]);
		});

		renderer.connect("accel-cleared", () => {
			updateShortcutRow(null);
			this.settings.set_strv(settingKey, []);
		});

		this.settings.connect("changed::" + settingKey, () => {
			updateShortcutRow(this.settings.get_strv(settingKey)[0]);
		});

		updateShortcutRow(this.settings.get_strv(settingKey)[0]);
	},

	_setupLayouts: function() {
		this._loadLayouts();

		const saveButton = this.builder.get_object("save-layout-button");
		saveButton.connect("clicked", button => {
			this._saveLayouts();
			this._loadLayouts();
		});
		const reloadButton = this.builder.get_object("reload-layout-button");
		reloadButton.connect("clicked", button => this._loadLayouts());
		const addButton = this.builder.get_object("add-layout-button");
		addButton.connect("clicked", button =>
				this._createLayoutRow(_getChildCount(this.builder.get_object("layouts-listbox"))));
	},

	_setupPieMenu() {
		this._loadPieMenu();

		const saveButton = this.builder.get_object("save-pie-menu-button");
		saveButton.connect("clicked", button => {
			this._savePieMenu();
			this._loadPieMenu();
		});
		const reloadButton = this.builder.get_object("reload-pie-menu-button");
		reloadButton.connect("clicked", button => this._loadPieMenu());
		const addButton = this.builder.get_object("add-pie-menu-item-button");
		addButton.connect("clicked", button => this._createPieMenuRow());
	},

	_loadLayouts: function() {
		const layoutsListBox = this.builder.get_object("layouts-listbox");
		_forEachChild(this, layoutsListBox, row => row.destroy());

		const path = GLib.build_filenamev([Me.dir.get_path(), ".layouts.json"]);
		const file = Gio.File.new_for_path(path);
		try {file.create(Gio.FileCreateFlags.NONE, null)} catch (e) {}

		const [success, contents] = file.load_contents(null);
		if (!success)
			return;

		const layouts = contents.length ? JSON.parse(contents) : [];
		layouts.length && layouts.forEach((layout, idx) => this._createLayoutRow(idx, layout));

		if (!layouts.length) // make sure there is at least 1 empty row
			this._createLayoutRow(0);
	},

	_saveLayouts: function() {
		const allLayouts = [];

		const layoutsListBox = this.builder.get_object("layouts-listbox");
		_forEachChild(this, layoutsListBox, row => {
			const layoutRects = [];
			_forEachChild(this, row.entriesContainer, entryBox => {
				const entry = shellVersion < 40 ? entryBox.get_children()[1]
						: entryBox.get_first_child().get_next_sibling();

				if (!entry.get_text_length())
					return;

				const text = _getEntryText(entry);
				const splits = text.split("--");
				if (splits.length !== 4)
					return;

				const rect = {};
				let rectIsValid = true;
				["x", "y", "width", "height"].forEach((property, i) => {
					const value = parseFloat(splits[i].trim());
					if (Number.isNaN(value))
						rectIsValid = false;

					rect[property] = value;
				});

				rectIsValid && layoutRects.push(rect);
			});

			const layoutName = row.getLayoutName();
			const layout = {name: layoutName, rects: layoutRects};
			layoutRects.length && allLayouts.push(layout);
		});

		const path = GLib.build_filenamev([Me.dir.get_path(), ".layouts.json"]);
		const file = Gio.File.new_for_path(path);
		try {file.create(Gio.FileCreateFlags.NONE, null)} catch (e) {}

		const [success] = file.replace_contents(JSON.stringify(allLayouts), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
		return success;
	},

	_createLayoutRow(index, layout) {
		// layout numbers are limited to 30
		// since there are only that many keybindings in the schemas file
		if (index >= 30)
			return;

		const row = new LayoutsRow(layout, index);
		const layoutsListBox = this.builder.get_object("layouts-listbox");
		_addChildTo(layoutsListBox, row);
		this._makeShortcutEdit(`activate-layout${index}`, row.treeView, row.listStore);
	},

	_loadPieMenu: function() {
		const pieMenuListBox = this.builder.get_object("pie-menu-listbox");
		_forEachChild(this, pieMenuListBox, row => row.destroy());

		const pieMenuItemIds = this.settings.get_strv("pie-menu-options");
		pieMenuItemIds.forEach(activeId => this._createPieMenuRow(activeId));
	},

	_savePieMenu: function() {
		const selectedIds = [];
		const pieMenuListBox = this.builder.get_object("pie-menu-listbox");
		_forEachChild(this, pieMenuListBox, row => {
			const id = row.getActiveId();
			id && selectedIds.push(id);
		});
		this.settings.set_strv("pie-menu-options", selectedIds);
	},

	_createPieMenuRow: function(activeId) {
		const options = [ // make sure this has the same order as tilingPieMenu.js
				"Toggle 'Maximize'", "Minimize window", "Close window", "Move to previous workspace", "Move to next workspace"
				, "Move to top monitor", "Move to bottom monitor", "Move to left monitor", "Move to right monitor"
				, "Toggle fullscreen", "Toggle 'Always on top'", "Tile left", "Tile right", "Tile top", "Tile bottom"
				, "Tile top-left", "Tile top-right", "Tile bottom-left", "Tile bottom-right"
		];
		const row = new PieMenuRow(options);
		activeId && row.setActiveId(activeId);
		_addChildTo(this.builder.get_object("pie-menu-listbox"), row);
	}
});

const LayoutsRow = GObject.registerClass(class LayoutsRow extends Gtk.ListBoxRow {
	_init(layout, idx) {
		super._init({
			selectable: false,
			margin_bottom: 12
		});

		const mainFrame = new Gtk.Frame({
			label: `    Layout ${idx + 1}    `,
			label_xalign: 0.5,
			margin_top: 8,
			margin_bottom: 8,
			margin_start: 8,
			margin_end: 8
		});
		_addChildTo(this, mainFrame)

		const mainBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 12,
			margin_top: 12,
			margin_bottom: 12,
			margin_start: 12,
			margin_end: 12
		});
		_addChildTo(mainFrame, mainBox)

		/* --- keybinding & name row --- */

		const topBox = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			homogeneous: true,
			spacing: 12
		});
		_addChildTo(mainBox, topBox);

		const keybindingFrame = new Gtk.Frame({margin_end: 8});
		_addChildTo(topBox, keybindingFrame);

		this.listStore = new Gtk.ListStore();
		this.listStore.set_column_types([GObject.TYPE_INT, GObject.TYPE_INT]);

		this.treeView = new Gtk.TreeView({
			model: this.listStore,
			halign: Gtk.Align.START,
			valign: Gtk.Align.CENTER,
			headers_visible: false
		});
		_addChildTo(keybindingFrame, this.treeView);

		this._nameEntry = new Gtk.Entry();
		const layoutName = layout && layout.name;
		layoutName && _setEntryText(this._nameEntry, layoutName);
		!layoutName && this._nameEntry.set_placeholder_text("Layout name...");
		_addChildTo(topBox, this._nameEntry);

		/* --- rectangles entries and preview row --- */

		const rectangleBox = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			homogeneous: true,
			spacing: 12,
			height_request: 175
		});
		_addChildTo(mainBox, rectangleBox);

		// left column (rectangle entries)
		const rectangleEntriesWindow = new Gtk.ScrolledWindow({vscrollbar_policy: Gtk.PolicyType.ALWAYS});
		_addChildTo(rectangleBox, rectangleEntriesWindow);

		const rectangleLeftBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 8,
			margin_end: 8
		})
		_addChildTo(rectangleEntriesWindow, rectangleLeftBox);

		this.entriesContainer = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 8,
		});
		_addChildTo(rectangleLeftBox, this.entriesContainer);

		layout && layout.rects.forEach(rect => this._addRectangleEntry(`${rect.x}--${rect.y}--${rect.width}--${rect.height}`));
		this._addRectangleEntry();

		const rectangleAddButton = new Gtk.Button();
		if (shellVersion < 40) {
			rectangleAddButton.set_always_show_image(true);
			rectangleAddButton.set_image(new Gtk.Image({icon_name: "list-add-symbolic"}));
		} else {
			rectangleAddButton.set_icon_name("list-add-symbolic");
		}
		_addChildTo(rectangleLeftBox, rectangleAddButton);
		rectangleAddButton.connect("clicked", () => this._addRectangleEntry());

		// right column (layout preview)
		const errorOverlay = new Gtk.Overlay();
		_addChildTo(rectangleBox, errorOverlay);

		const rectangleFrame = new Gtk.Frame();
		_addChildTo(errorOverlay, rectangleFrame);

		const [layoutIsValid, errMsg] = this._layoutIsValid(layout);
		if (layoutIsValid) {
			const drawingArea = new Gtk.DrawingArea();
			_addChildTo(rectangleFrame, drawingArea);
			shellVersion < 40 ? drawingArea.connect("draw", (widget, cr) => this._drawPreview(layout, widget, cr))
					: drawingArea.set_draw_func(this._drawPreview.bind(this, layout));

		} else {
			const errorLabel = new Gtk.Label({
				label: errMsg,
				halign: Gtk.Align.CENTER,
				valign: Gtk.Align.CENTER,
				visible: true,
				wrap: true
			});
			errorOverlay.add_overlay(errorLabel);
		}

		/* --- button row --- */

		const deleteButton = new Gtk.Button();
		if (shellVersion < 40) {
			deleteButton.set_always_show_image(true);
			deleteButton.set_image(new Gtk.Image({icon_name: "edit-delete-symbolic"}));
		} else {
			deleteButton.set_icon_name("edit-delete-symbolic");
		}
		_addChildTo(mainBox, deleteButton);
		deleteButton.connect("clicked", button => this.destroy());

		shellVersion < 40 && this.show_all();
	}

	destroy() {
		shellVersion < 40 ? super.destroy() : this.get_parent().remove(this);
	}

	getLayoutName() {
		return _getEntryText(this._nameEntry);
	}

	_addRectangleEntry(text) {
		const entryBox = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 8
		});
		_addChildTo(this.entriesContainer, entryBox);

		const entryCount = _getChildCount(this.entriesContainer);
		const entryLabel = new Gtk.Label({label: `${entryCount}:`});
		_addChildTo(entryBox, entryLabel);

		const tooltip = "Set a keybinding by clicking the 'Disabled' text. Enter the dimensions of the rectangles for the layouts in the left column.\
The right column shows a preview of your layouts (after saving). Format for the rectangles:\n\nxVal--yVal--widthVal--heightVal\n\n\
The values can range from 0 to 1. (0,0) is the top-left corner of your screen. (1,1) is the bottom-right corner."
		const rectEntry = new Gtk.Entry({
			tooltip_text: tooltip,
			hexpand: true
		});
		!text && entryCount <= 1 && rectEntry.set_placeholder_text("tooltip for help...");
		text && _setEntryText(rectEntry, text);
		_addChildTo(entryBox, rectEntry);

		shellVersion < 40 && entryBox.show_all();
	}

	_drawPreview(layout, drawingArea, cr) {
		const color = new Gdk.RGBA();
		const width = drawingArea.get_allocated_width();
		const height = drawingArea.get_allocated_height();

		cr.setLineWidth(1.0);

		layout.rects.forEach(rect => {
			// 1px outline for rect in transparent white
			// 5 px gaps between rects
			color.parse("rgba(255, 255, 255, .2)");
			Gdk.cairo_set_source_rgba(cr, color);
			cr.moveTo(rect.x * width + 5, rect.y * height + 5);
			cr.lineTo((rect.x + rect.width) * width - 5, rect.y * height + 5);
			cr.lineTo((rect.x + rect.width) * width - 5, (rect.y + rect.height) * height - 5);
			cr.lineTo(rect.x * width + 5, (rect.y + rect.height) * height - 5);
			cr.lineTo(rect.x * width + 5, rect.y * height + 5);
			cr.strokePreserve();

			// fill rect in transparent black
			color.parse("rgba(0, 0, 0, .15)");
			Gdk.cairo_set_source_rgba(cr, color);
			cr.fill();
		});

		cr.$dispose();
	}

	_layoutIsValid(layout) {
		if (!layout)
			return [false, "No preview..."];

		// calculate the surface area of an overlap
		const rectsOverlap = function(r1, r2) {
			return Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x))
					* Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
		}

		for (let i = 0; i < layout.rects.length; i++) {
			const rect = layout.rects[i];
			// rects is/reaches outside of screen (i. e. > 1)
			if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1)
				return [false, `Rectangle ${i + 1} is (partly) outside of the screen.`];

			for (let j = i + 1; j < layout.rects.length; j++) {
				if (rectsOverlap(rect, layout.rects[j]))
					return [false, `Rectangles ${i + 1} and ${j + 1} overlap.`];
			}
		}

		return [true, ""];
	}
});

const PieMenuRow = GObject.registerClass(class PieMenuRow extends Gtk.ListBoxRow {
	_init(options) {
		super._init();

		const mainBox = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 6
		});
		_addChildTo(this, mainBox);

		this._comboBox = new Gtk.ComboBoxText({
			popup_fixed_width: true,
			hexpand: true
		});
		options.forEach((option, idx) => this._comboBox.append(idx.toString(), option));
		_addChildTo(mainBox, this._comboBox);

		const deleteButton = new Gtk.Button();
		if (shellVersion < 40) {
			deleteButton.set_always_show_image(true);
			deleteButton.set_image(new Gtk.Image({icon_name: "edit-delete-symbolic"}));
		} else {
			deleteButton.set_icon_name("edit-delete-symbolic");
		}
		_addChildTo(mainBox, deleteButton);
		deleteButton.connect("clicked", () => this.destroy());

		shellVersion < 40 && this.show_all();
	}

	destroy() {
		shellVersion < 40 ? super.destroy() : this.get_parent().remove(this);
	}

	setActiveId(id) {
		this._comboBox.set_active_id(id);
	}

	getActiveId() {
		return this._comboBox.get_active_id();
	}
});

/* --- GTK 4 compatibility --- */

function _getEntryText(entry) {
	return shellVersion < 40 ? entry.get_text() : entry.get_buffer().get_text();
}

function _setEntryText(entry, text) {
	shellVersion < 40 ? entry.set_text(text) : entry.get_buffer().set_text(text, -1);
}

function _getChildCount(container) {
	if (shellVersion < 40)
		return container.get_children().length;

	let childCount = 0;
	for (let child = container.get_first_child(); !!child; child = child.get_next_sibling())
		childCount++;
	return childCount;
}

function _forEachChild(that, container, callback) {
	if (shellVersion < 40) {
		container.foreach(callback.bind(that));

	} else {
		for (let child = container.get_first_child(); !!child;) {
			const nxtSibling = child.get_next_sibling();
			callback.call(that, child);
			child = nxtSibling;
		}
	}
}

function _addChildTo(parent, child) {
	if (parent instanceof Gtk.Box || parent instanceof Gtk.ListBox)
		shellVersion < 40 ? parent.add(child) : parent.append(child);

	else if (parent instanceof Gtk.ListBoxRow || parent instanceof Gtk.ScrolledWindow || parent instanceof Gtk.Frame || parent instanceof Gtk.Overlay)
		shellVersion < 40 ? parent.add(child) : parent.set_child(child);
}
