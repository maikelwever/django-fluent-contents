/**
 * This file deals with the internal DOM manipulations within a content placeholder.
 * namely the plugin ("content item types") which are added, reordered, and removed there.
 */
var cp_plugins = {};

(function($){

  // Global state
  var has_load_error = false;
  var restore_timer = null;

  // Allow debugging
  var stub = function() {};
  var console = window.console || {'log': stub, 'error': stub};

  // Settings
  var plugin_handlers = {};


  cp_plugins.init = function()
  {
    $("#content-main > form").submit( cp_plugins.onFormSubmit );
    $(".cp-plugin-add-button").live( 'click', cp_plugins.onAddButtonClick );
    $(".cp-item-controls .cp-item-up").live( 'click', cp_plugins.onItemUpClick );
    $(".cp-item-controls .cp-item-down").live( 'click', cp_plugins.onItemDownClick );
    $(".cp-item-controls .cp-item-delete a").live( 'click', cp_plugins.onDeleteClick );
  }


  /**
   * Move all formset items to their appropriate tabs.
   * The tab is selected based on template key, and role.
   */
  cp_plugins.move_items_to_placeholders = function()
  {
    // Count number of seen tabs per role.
    var roles_seen = {};
    for(var i in cp_data.placeholders)
      roles_seen[cp_data.placeholders[i].role] = 0;

    // Move all items to the tabs.
    for(var placeholder_key in cp_data.dom_placeholders)
    {
      var dom_placeholder = cp_data.dom_placeholders[placeholder_key];
      roles_seen[dom_placeholder.role]++;

      if( dom_placeholder.items.length == 0)
        continue;

      // Fill the tab
      var last_role_occurance = roles_seen[dom_placeholder.role];
      var pane = cp_data.get_placeholder_pane(placeholder_key, last_role_occurance);

      cp_plugins.move_items_to_pane(dom_placeholder, pane);
    }
  }


  /**
   * Move the items of one placeholder to the given tab.
   */
  cp_plugins.move_items_to_pane = function(dom_placeholder, pane)
  {
    if( pane.content.length == 0)
    {
      if( window.console )
        window.console.error("Invalid tab, missing tab-content: ", pane);
      return;
    }

    console.log("move_items_to_pane:", dom_placeholder, pane);

    // Reorder in accordance to the sorting order.
    cp_plugins._sort_items( dom_placeholder.items );

    // Move all items to that tab.
    // Restore item values upon restoring fields.
    for(var i in dom_placeholder.items)
    {
      var fs_item = dom_placeholder.items[i];
      dom_placeholder.items[i] = cp_plugins._move_item_to( fs_item, function(fs_item) { pane.content.append(fs_item); } );
    }

    if( dom_placeholder.items.length )
      pane.empty_message.hide();
  }


  /**
   * Move an item to a new place.
   */
  cp_plugins._move_item_to = function( fs_item, add_action )
  {
    var itemId  = fs_item.attr("id");

    // Remove the item.
    cp_plugins.disable_pageitem(fs_item);   // needed for WYSIWYG editors!
    var values = cp_plugins._get_input_values(fs_item);
    add_action( fs_item.remove() );

    // Fetch the node reference as it was added to the DOM.
    fs_item = $("#" + itemId);

    // Re-enable the item
    cp_plugins._set_input_values(fs_item, values);
    cp_plugins.enable_pageitem(fs_item);

    // Return to allow updating the administration
    return fs_item;
  }


  cp_plugins._get_input_values = function(root)
  {
    var inputs = root.find(":input");
    var values = {};
    for(var i = 0; i < inputs.length; i++)
    {
      var input = inputs.eq(i);
      values[input.attr("name")] = input.val();
    }

    return values;
  }


  cp_plugins._set_input_values = function(root, values)
  {
    var inputs = root.find(":input");
    for(var i = 0; i < inputs.length; i++)
    {
      var input = inputs.eq(i);
      var value = values[input.attr("name")];
      if(value != null)
        input.val(value);
    }
  }


  // -------- Add plugin feature ------

  /**
   * Add plugin click
   */
  cp_plugins.onAddButtonClick = function(event)
  {
    var add_button = $(event.target);
    var placeholder_key = add_button.attr("data-placeholder-slot");  // TODO: use ID?
    var itemtype_name = add_button.siblings("select").val();
    cp_plugins.add_formset_item( placeholder_key, itemtype_name );
  }


  /**
   * Add an item to a tab.
   */
  cp_plugins.add_formset_item = function( placeholder_slot, itemtype_name )
  {
    // The Django admin/media/js/inlines.js API is not public, or easy to use.
    // Recoded the inline model dynamics.

    // Get objects
    var itemtype = itemtypes[itemtype_name];
    var group_prefix = itemtype.auto_id.replace(/%s/, itemtype.prefix);
    var placeholder = cp_data.get_placeholder_by_slot(placeholder_slot);
    var dom_placeholder = cp_data.get_or_create_dom_placeholder(placeholder);

    // Get DOM items
    var pane  = cp_data.get_placeholder_pane(placeholder_slot);
    var total = $("#" + group_prefix + "-TOTAL_FORMS")[0];

    // Clone the item.
    var new_index = total.value;
    var item_id   = itemtype.prefix + "-" + new_index;
    var newhtml = itemtype.item_template.get_outerHtml().replace(/__prefix__/g, new_index);
    var newitem = $(newhtml).removeClass("empty-form").attr("id", item_id);

    // Add it
    pane.content.append(newitem);
    pane.empty_message.hide();

    var fs_item = $("#" + item_id);
    if( fs_item.length == 0 )
      throw new Error("New FormSetItem not found: #" + item_id)

    // Update administration
    dom_placeholder.items.push(fs_item);
    total.value++;

    // Configure it
    var field_prefix = group_prefix + "-" + new_index;
    $("#" + field_prefix + "-placeholder").val(placeholder.id);
    $("#" + field_prefix + "-placeholder_slot").val(placeholder.slot);
    $("#" + field_prefix + "-sort_order").val(new_index);
    cp_plugins.enable_pageitem(fs_item);
  }


  // -------- Move plugin ------


  cp_plugins.onItemUpClick = function(event)
  {
    event.preventDefault();
    cp_plugins.swap_formset_item(event.target, true);
  }


  cp_plugins.onItemDownClick = function(event)
  {
    event.preventDefault();
    cp_plugins.swap_formset_item(event.target, false);
  }


  cp_plugins.swap_formset_item = function(child_node, isUp)
  {
    var current_item = cp_data.get_formset_item_data(child_node);
    var fs_item = current_item.fs_item;
    var relative = fs_item[isUp ? 'prev' : 'next']("div");
    if(!relative.length) return;

    // Avoid height flashes by fixating height
    // FIXME: this breaks encapsulation of the tabbar control. Yet it is pretty easy this way.
    clearTimeout( restore_timer );
    var tabmain = $("#cp-tabmain");
    tabmain.css("height", tabmain.height() + "px");
    fs_item.css("height", fs_item.height() + "px");

    // Swap
    var pane = cp_data.get_placeholder_pane_for_item( fs_item );
    fs_item = cp_plugins._move_item_to( fs_item, function(fs_item) { fs_item[isUp ? 'insertBefore' : 'insertAfter'](relative); } );
    cp_plugins.update_sort_order(pane);

    // Give more then enough time for the YUI editor to restore.
    // The height won't be changed within 2 seconds at all.
    restore_timer = setTimeout(function() {
      fs_item.css("height", '');
      tabmain.css("height", '');
    }, 500);
  }


  cp_plugins.onFormSubmit = function(event)
  {
    var panes = cp_data.get_placeholder_panes();
    for(var i = 0; i < panes.length; i++)
    {
      cp_plugins.update_sort_order(panes[i]);
    }
  }


  cp_plugins.update_sort_order = function(tab)
  {
    // Can just assign the order in which it exists in the DOM.
    var sort_order = tab.content.find("input[id$=-sort_order]");
    for(var i = 0; i < sort_order.length; i++)
    {
      sort_order[i].value = i;
    }
  }


  cp_plugins._sort_items = function(items)
  {
    // The sort_order field is likely top-level, but the fieldset html can place it anywhere.
    for( var i in items)
    {
      var fs_item = items[i];
      fs_item._sort_order = parseInt(fs_item.find("input[id$=-sort_order]:first").val());
    }

    items.sort(function(a, b) { return a._sort_order - b._sort_order; });
  }



  // -------- Delete plugin ------


  /**
   * Delete item click
   */
  cp_plugins.onDeleteClick = function(event)
  {
    event.preventDefault();
    cp_plugins.remove_formset_item(event.target);
  }


  cp_plugins.remove_formset_item = function(child_node)
  {
    // Get dom info
    var current_item = cp_data.get_formset_item_data(child_node);
    var dominfo      = cp_plugins._get_formset_dom_info(current_item);
    var itemtype     = current_item.itemtype;

    // Get administration
    // Slot is always filled in, id may be unknown yet.
    var placeholder  = cp_data.get_placeholder_by_id( dominfo.placeholder_id );
    var total_count  = parseInt(dominfo.total_forms.value);

    // Final check
    if( dominfo.id_field.length == 0 )
      throw new Error("ID field not found for deleting objects!");

    // Disable item, wysiwyg, etc..
    cp_plugins.disable_pageitem(current_item.fs_item);

    // In case there is a delete checkbox, save it.
    if( dominfo.delete_checkbox.length )
    {
      var id_field = dominfo.id_field.remove().insertAfter(dominfo.total_forms);
      dominfo.delete_checkbox.attr('checked', true).remove().insertAfter(dominfo.total_forms);
    }
    else
    {
      // Newly added item, renumber in reverse order
      for( var i = current_item.index + 1; i < total_count; i++ )
      {
        var fs_item = $("#" + itemtype.prefix + "-" + i);
        cp_plugins._renumber_formset_item(fs_item, itemtype.prefix, i - 1);
      }

      dominfo.total_forms.value--;
    }

    // And remove item
    current_item.fs_item.remove();

    // Remove from node list, if all removed, show empty tab message.
    if( cp_data.remove_dom_item(placeholder.slot, current_item))
    {
      var pane = cp_data.get_placeholder_pane(placeholder.slot, 0);
      pane.empty_message.show();
    }
  }


  cp_plugins._get_formset_dom_info = function(current_item)
  {
    var itemtype     = current_item.itemtype;
    var group_prefix = itemtype.auto_id.replace(/%s/, itemtype.prefix);
    var field_prefix = group_prefix + "-" + current_item.index;

    var placeholder_id = $("#" + field_prefix + "-placeholder").val();  // .val allows <select> for debugging.
    var placeholder_slot = $("#" + field_prefix + "-placeholder_slot")[0].value;

    // Placeholder slot may only filled in when creating items,
    // so restore that info from the existing database.
    if( placeholder_id && !placeholder_slot )
      placeholder_slot = cp_data.get_placeholder_by_id(placeholder_id).slot

    return {
      // for debugging
      root: current_item.fs_item,

      // management form item
      total_forms: $("#" + group_prefix + "-TOTAL_FORMS")[0],

      // Item fields
      id_field: $("#" + field_prefix + "-contentitem_ptr"),
      delete_checkbox: $("#" + field_prefix + "-DELETE"),
      placeholder_id: placeholder_id,  // .val allows <select> for debugging.
      placeholder_slot: placeholder_slot
    };
  }


  // Based on django/contrib/admin/media/js/inlines.js
  cp_plugins._renumber_formset_item = function(fs_item, prefix, new_index)
  {
    var id_regex = new RegExp("(" + prefix + "-(\\d+|__prefix__))");
    var replacement = prefix + "-" + new_index;

    // Loop through the nodes.
    // Getting them all at once turns out to be more efficient, then looping per level.
    var nodes = fs_item.add( fs_item.find("*") );
    for( var i = 0; i < nodes.length; i++ )
    {
      var node = nodes[i];
      var $node = $(node);

      var for_attr = $node.attr('for');
      if( for_attr )
        $node.attr("for", for_attr.replace(id_regex, replacement));

      if( node.id )
        node.id = node.id.replace(id_regex, replacement);

      if( node.name )
        node.name = node.name.replace(id_regex, replacement);
    }
  }


  // -------- Page item scripts ------

  /**
   * Register a class which can update the appearance of a plugin
   * when it is loaded in the DOM tree.
   */
  cp_plugins.register_view_handler = function(model_typename, view_handler)
  {
    var typename = model_typename;
    if( plugin_handlers[ typename ] )
      throw new Error("Plugin already registered: " + typename);
    //if( cp_data.get_formset_itemtype( typename ) == null )
    //  throw new Error("Plugin Model type unknown: " + typename);

    plugin_handlers[ typename ] = view_handler;
  }


  cp_plugins.get_view_handler = function(fs_item)
  {
    var itemdata = cp_data.get_formset_item_data(fs_item);
    var itemtype = itemdata.itemtype.type;
    return plugin_handlers[ itemtype ];
  }


  cp_plugins.enable_pageitem = function(fs_item)
  {
    var view_handler = cp_plugins.get_view_handler(fs_item);
    if( view_handler ) view_handler.enable(fs_item);
  }


  cp_plugins.disable_pageitem = function(fs_item)
  {
    var view_handler = cp_plugins.get_view_handler(fs_item);
    if( view_handler ) view_handler.disable(fs_item);
  }


  // -------- Extra jQuery plugin ------

  /**
   * jQuery outerHTML plugin
   * Very simple, and incomplete - but sufficient for here.
   */
  $.fn.get_outerHtml = function( html )
  {
    if( this.length )
    {
      if( this[0].outerHTML )
        return this[0].outerHTML;
      else
        return $("<div>").append( this.clone() ).html();
    }
  }

})(window.jQuery || django.jQuery);