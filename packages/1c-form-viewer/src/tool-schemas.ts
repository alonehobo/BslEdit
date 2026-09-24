/* MCP tool schemas, kept verbatim with native/mcp-server.cpp so the Node
 * server and the native server present the same contract to clients. */

export const TOOL_SCHEMAS = [
  {
    "name": "open_preview",
    "description": "Open and render a visual preview of a 1C:Enterprise managed form, form layout, spreadsheet template, or MXL file. Use this when the user asks to show a 1C form visually, open a form layout, inspect the form interface, or see how the form looks. Do not launch 1C:Enterprise or the configurator, and do not show XML source when a visual preview is requested. A metadata descriptor such as Forms/ФормаДокумента.xml is automatically resolved to Forms/ФормаДокумента/Ext/Form.xml. Показывает визуальное представление формы или макета 1С, а не исходный XML. Используйте для запросов «покажи форму», «открой макет формы», «покажи визуально» и «посмотри внешний вид формы». Не запускайте 1С и не открывайте XML-редактор. Decide the audience before calling: audience=\"user\" when the user asks to show, open or see a form or template (\"покажи\", \"открой\", \"хочу посмотреть\") — it opens a window on the user's screen; audience=\"agent\" when you only need the preview yourself (inspect_preview, capture_preview, checking your own edit) — it renders in a hidden browser the user never sees, and your screenshots are not shown to the user either. Each opened file is a separate preview with its own preview_id and URL; opening another file does not replace earlier previews, so several can be shown at once. Reopening the same file reuses its preview. Сначала решите, для кого открываете: audience=\"user\" — пользователь просит показать или открыть (окно на его экране); audience=\"agent\" — превью нужно только вам (скрытый браузер, пользователь ничего не видит). Каждый файл открывается отдельным превью со своей ссылкой.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Absolute or workspace-relative path to Form.xml, a Forms/ИмяФормы.xml descriptor, Template.xml, or an MXL file."
        },
        "audience": {
          "type": "string",
          "enum": [
            "user",
            "agent"
          ],
          "description": "user: the user asked to see it, open a window on their screen. agent: for your own inspection, render hidden."
        },
        "show": {
          "type": "boolean",
          "description": "Deprecated spelling of audience: true = user, false = agent. Ignored when audience is given."
        }
      },
      "required": [
        "path",
        "audience"
      ]
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "requestedPath": {
          "type": "string"
        },
        "resolvedPath": {
          "type": "string"
        },
        "path": {
          "type": "string"
        },
        "previewId": {
          "type": "string"
        },
        "audience": {
          "type": "string",
          "enum": [
            "user",
            "agent"
          ]
        },
        "previewUrl": {
          "type": "string"
        },
        "presentation": {
          "type": "string",
          "enum": [
            "hidden",
            "window",
            "client",
            "unavailable"
          ]
        },
        "kind": {
          "type": "string",
          "enum": [
            "managed-form",
            "spreadsheet-template",
            "mxl",
            "xml"
          ]
        },
        "size": {
          "type": "integer"
        },
        "encoding": {
          "type": "string"
        }
      },
      "required": [
        "requestedPath",
        "resolvedPath",
        "previewUrl",
        "kind",
        "size",
        "encoding"
      ]
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "preview",
    "description": "Work with an open 1C preview; pass operation and that operation's arguments. Open a file with open_preview first and take screenshots with capture_preview; preview_id picks one of several open previews, the last used one by default. Operations: inspect — element and page ids, captions, visibility, nesting, tabs and scroll areas, narrowed by query and visible_only; use it to discover ids before navigating or capturing; switch_tab — activate a page by page_id (pages_id for a nested set); select — reveal the parent pages of element_id, highlight it and scroll it into view; scroll — move target document, active-page, table or spreadsheet by delta_x/delta_y or to x/y (element_id picks the table or field); reload — re-read the file after it changed, keeping the current view; url — the loopback URL of that preview plus every open preview with its previewId, path and previewUrl; close — end one preview (preview_id) or all of them, leaving every source file alone and their URLs dead. Инспекция, вкладки, выделение, прокрутка, перечитывание и закрытие превью.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "inspect",
            "switch_tab",
            "select",
            "scroll",
            "reload",
            "url",
            "close"
          ]
        },
        "preview_id": {
          "type": "string",
          "description": "Preview to act on, from open_preview; the last used preview by default."
        },
        "query": {
          "type": "string",
          "description": "inspect: narrow the listing to matching names and captions."
        },
        "visible_only": {
          "type": "boolean",
          "description": "inspect: skip hidden elements."
        },
        "page_id": {
          "type": "string",
          "description": "switch_tab: the page to activate."
        },
        "pages_id": {
          "type": "string",
          "description": "switch_tab: the nested page set that owns page_id."
        },
        "element_id": {
          "type": "string",
          "description": "select: the element to highlight; scroll: the table or spreadsheet field to move."
        },
        "target": {
          "type": "string",
          "enum": [
            "document",
            "active-page",
            "table",
            "spreadsheet"
          ],
          "description": "scroll: what to move."
        },
        "delta_x": {
          "type": "number"
        },
        "delta_y": {
          "type": "number"
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      },
      "required": [
        "operation"
      ]
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "capture_preview",
    "description": "Capture the opened 1C preview viewport, full document, or one visible element as PNG. Use this for screenshots and visual comparison after navigating to the requested area.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "preview_id": {
          "type": "string",
          "description": "Preview to act on, from open_preview; the last used preview by default."
        },
        "scope": {
          "type": "string",
          "enum": [
            "viewport",
            "document",
            "element"
          ]
        },
        "element_id": {
          "type": "string"
        }
      }
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "convert_xlsx_to_template",
    "description": "Convert an Excel workbook (.xlsx) into a 1C spreadsheet template Ext/Template.xml and open it in the preview. Use this when a print form layout is given as xlsx. Text, fonts, colors, fills, borders, alignment, column widths, row heights, merges and headers/footers are kept; Excel defined names become named areas, a cell with exactly [Name] becomes a parameter, text with [Name] inside becomes a template. The result lists areas, parameters and what was not converted. Then check it with capture_preview and list_markup, and refine the markup with edit_template (operations set_area, set_parameter) when that tool is available. Конвертирует макет печатной формы из xlsx в Template.xml 1С и сразу открывает превью.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "xlsx_path": {
          "type": "string",
          "description": "Path to the .xlsx workbook."
        },
        "output_path": {
          "type": "string",
          "description": "Path of the Template.xml to write, for example Templates/ПФ_MXL_Акт/Ext/Template.xml."
        },
        "sheet": {
          "type": "string",
          "description": "Sheet name; the first visible sheet by default."
        },
        "overwrite": {
          "type": "boolean",
          "description": "Replace an existing output file. Default false."
        }
      },
      "required": [
        "xlsx_path",
        "output_path"
      ]
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false
    }
  },
  {
    "name": "list_markup",
    "description": "List the markup of a 1C spreadsheet template (Template.xml): named areas with their rows/columns, parameter cells and template cells, all with 1-based row and column numbers as the preview shows them. Показывает области, параметры и шаблоны макета.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to Template.xml."
        }
      },
      "required": [
        "path"
      ]
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "validate_template",
    "description": "Check a 1C spreadsheet template (Template.xml) for broken structure: format, font and line references, cells and merges outside the document or column set, malformed or duplicate named areas, parameter cells without names. Run it after editing a template. Проверяет макет на ошибки структуры.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to Template.xml."
        }
      },
      "required": [
        "path"
      ]
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "edit_template",
    "description": "Edit a 1C spreadsheet template (Template.xml) in place; pass path, operation and that operation's arguments. Rows and columns are 1-based as in the preview; an open preview of the file is refreshed, so check it with capture_preview, and run validate_template after a series of edits. Operations: set_area — name, begin_row/end_row and/or begin_column/end_column (rows only → Rows area, columns only → Columns, both → Rectangle), remove=true deletes the area; set_parameter — row, column and one of name (parameter), template (text with [Name]) or text (plain); detail sets the drill-down parameter, alone or together; set_format — row, column, optional to_row/to_column, and any of font{face,size,bold,italic,underline,strikeout}, horizontal_alignment, vertical_alignment, text_placement, indent, text_color, back_color, border_color (#RRGGBB or style:Name), border / left_border / top_border / right_border / bottom_border (a style name or {style,width}), format (e.g. ЧДЦ=2, ДФ=dd.MM.yyyy), protection; null resets a property; insert_rows / delete_rows / insert_columns / delete_columns — at, count, columns_id for column sets; merges, areas and drawings move with the grid; merge_cells — row, column, rows, columns, or unmerge=true; set_size — column (+to_column) with width in template units, or row (+to_row) with height in points (0 = automatic); set_print_settings — orientation, scale, fit_to_page, paper, copies, black_and_white, first_page_number, top/left/bottom/right_margin and header/footer_size in mm, print_area {begin_row,end_row,begin_column,end_column} or null; set_header_footer — kind header|footer, left/center/right texts ([&НомерСтраницы], [&СтраницВсего], [&Дата], [&Время]), font, remove. Правка макета печатной формы: области, параметры, оформление, строки и колонки, объединения, размеры, печать, колонтитулы.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to Template.xml."
        },
        "operation": {
          "type": "string",
          "enum": [
            "set_area",
            "set_parameter",
            "set_format",
            "insert_rows",
            "delete_rows",
            "insert_columns",
            "delete_columns",
            "merge_cells",
            "set_size",
            "set_print_settings",
            "set_header_footer"
          ]
        },
        "name": {
          "type": "string",
          "description": "Area name (set_area) or parameter name (set_parameter); a 1C identifier."
        },
        "begin_row": {
          "type": "integer",
          "minimum": 1
        },
        "end_row": {
          "type": "integer",
          "minimum": 1
        },
        "begin_column": {
          "type": "integer",
          "minimum": 1
        },
        "end_column": {
          "type": "integer",
          "minimum": 1
        },
        "remove": {
          "type": "boolean",
          "description": "set_area: remove the named area; set_header_footer: remove the header or footer."
        },
        "row": {
          "type": "integer",
          "minimum": 1
        },
        "column": {
          "type": "integer",
          "minimum": 1
        },
        "template": {
          "type": "string",
          "description": "Text with [Name] parameters, for example «Счёт № [Номер] от [Дата]»."
        },
        "text": {
          "type": "string",
          "description": "Plain text for the cell."
        },
        "detail": {
          "type": "string",
          "description": "Drill-down parameter name; empty string removes it."
        },
        "to_row": {
          "type": "integer",
          "minimum": 1
        },
        "to_column": {
          "type": "integer",
          "minimum": 1
        },
        "font": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "face": {
                  "type": "string"
                },
                "size": {
                  "type": "number"
                },
                "bold": {
                  "type": "boolean"
                },
                "italic": {
                  "type": "boolean"
                },
                "underline": {
                  "type": "boolean"
                },
                "strikeout": {
                  "type": "boolean"
                }
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "set_format, set_header_footer: font changes; null (set_format) returns to the inherited font."
        },
        "horizontal_alignment": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "Left",
                "Center",
                "Right",
                "Justify",
                "Auto"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "vertical_alignment": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "Top",
                "Center",
                "Bottom"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "text_placement": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "Auto",
                "Wrap",
                "Cut",
                "Block"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "indent": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "text_color": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "description": "#RRGGBB or style:/web:/win:Name."
        },
        "back_color": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "border_color": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "border": {
          "description": "Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object",
              "properties": {
                "style": {
                  "type": "string"
                },
                "width": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "left_border": {
          "description": "Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object",
              "properties": {
                "style": {
                  "type": "string"
                },
                "width": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "top_border": {
          "description": "Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object",
              "properties": {
                "style": {
                  "type": "string"
                },
                "width": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "right_border": {
          "description": "Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object",
              "properties": {
                "style": {
                  "type": "string"
                },
                "width": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "bottom_border": {
          "description": "Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object",
              "properties": {
                "style": {
                  "type": "string"
                },
                "width": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "format": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "description": "1C format string, e.g. ЧДЦ=2 or ДФ=dd.MM.yyyy."
        },
        "protection": {
          "type": "boolean"
        },
        "at": {
          "type": "integer",
          "minimum": 1,
          "description": "Insert before this row/column, or delete starting from it."
        },
        "count": {
          "type": "integer",
          "minimum": 1,
          "description": "Rows or columns to insert or delete; 1 by default."
        },
        "columns_id": {
          "type": "string",
          "description": "Column set id for column edits; the default set when omitted."
        },
        "rows": {
          "type": "integer",
          "minimum": 1
        },
        "columns": {
          "type": "integer",
          "minimum": 1
        },
        "unmerge": {
          "type": "boolean"
        },
        "width": {
          "type": "number",
          "minimum": 0
        },
        "height": {
          "type": "number",
          "minimum": 0
        },
        "orientation": {
          "type": "string",
          "enum": [
            "Portrait",
            "Landscape"
          ]
        },
        "scale": {
          "type": "integer",
          "minimum": 10,
          "maximum": 400
        },
        "fit_to_page": {
          "type": "boolean"
        },
        "paper": {
          "type": "integer",
          "minimum": 0
        },
        "copies": {
          "type": "integer",
          "minimum": 0
        },
        "black_and_white": {
          "type": "boolean"
        },
        "first_page_number": {
          "type": "integer",
          "minimum": 0
        },
        "top_margin": {
          "type": "number",
          "minimum": 0
        },
        "left_margin": {
          "type": "number",
          "minimum": 0
        },
        "bottom_margin": {
          "type": "number",
          "minimum": 0
        },
        "right_margin": {
          "type": "number",
          "minimum": 0
        },
        "header_size": {
          "type": "number",
          "minimum": 0
        },
        "footer_size": {
          "type": "number",
          "minimum": 0
        },
        "print_area": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "begin_row": {
                  "type": "integer",
                  "minimum": 1
                },
                "end_row": {
                  "type": "integer",
                  "minimum": 1
                },
                "begin_column": {
                  "type": "integer",
                  "minimum": 1
                },
                "end_column": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "kind": {
          "type": "string",
          "enum": [
            "header",
            "footer"
          ]
        },
        "left": {
          "type": "string"
        },
        "center": {
          "type": "string"
        },
        "right": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "operation"
      ]
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true
    }
  },
  {
    "name": "list_form_elements",
    "description": "List the items of a 1C managed form (Ext/Form.xml, or its Forms/Name.xml descriptor) as a tree: name, kind (InputField, UsualGroup, Page, Table, Button…), parent and data path. Use the names with edit_form. Показывает дерево элементов формы.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to Ext/Form.xml or the Forms/Name.xml descriptor."
        }
      },
      "required": [
        "path"
      ]
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "validate_form",
    "description": "Check a 1C managed form (Ext/Form.xml) for broken structure: duplicate ids, missing companion nodes (ContextMenu, ExtendedTooltip…), data paths without a form attribute, buttons without a command, events without a handler, main attribute count, format version. Run it after editing a form. Проверяет форму на ошибки структуры.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to Ext/Form.xml or the Forms/Name.xml descriptor."
        }
      },
      "required": [
        "path"
      ]
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "edit_form",
    "description": "Edit a 1C managed form (Ext/Form.xml) in place; pass path, operation and that operation's arguments. Items are addressed by name (see list_form_elements or preview with operation=inspect); only the touched nodes change, the rest of the file stays byte for byte. An open preview of the file is refreshed, so check it with capture_preview, and run validate_form after a series of edits. Operations: set_properties — element (omit or Form for the form itself) and properties {PropertyNode: value}: the XML node name as Designer writes it (Title, ToolTip, Visible, Enabled, ReadOnly, Width, Height, AutoMaxWidth, HorizontalStretch, VerticalStretch, TitleLocation, Group, Representation, ShowTitle…); multilingual properties take a string (ru) or {ru, en}; null returns a property to its default; enum values are checked. A color takes style:Name, web:Name, win:Name or #RRGGBB; a font takes {ref: \"style:Name\"} or {face, height, bold, italic, underline, strikeout, scale}; a picture takes CommonPicture.Name or StdPicture.Name; a choice list and the role tables are not changed. move_element — element and into (group, page, pages, table, command bar or Form) and/or after/before a sibling. add_element — element (the new name), kind (InputField, CheckBoxField, RadioButtonField, LabelField, LabelDecoration, PictureField, PictureDecoration, CalendarField, Table, UsualGroup, ColumnGroup, Pages, Page, Button, ButtonGroup, Popup, CommandBar and the document fields), into and/or after/before, and properties as in set_properties; the companion nodes (ContextMenu, ExtendedTooltip, a table's panels) and the ids are generated. remove_element — element with its companions and nested items; refused while standard commands or conditional appearance refer to it unless force=true; handlers in the form module are not touched. set_attribute — name plus type for a new form attribute, and columns for a table attribute (string, string(100), string(1,fixed), boolean, number(15,2), number(15,2,nonnegative), date, dateTime, time, CatalogRef.Имя, DocumentObject.Имя, EnumRef.Имя, DefinedType.Имя, ValueTable, several types through |, or a ready cfg:/v8:/xs: name), title, main, saved_data, fill_check; remove=true deletes it, refused while a data path uses it unless force=true. set_command — name, action (the handler name in the form module, which is not created), title, tooltip, shortcut, representation, modifies_saved_data, current_row_use; remove=true deletes it, refused while a button uses it unless force=true. Правка управляемой формы: свойства, перенос и удаление элементов.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to Ext/Form.xml or the Forms/Name.xml descriptor."
        },
        "operation": {
          "type": "string",
          "enum": [
            "set_properties",
            "add_element",
            "move_element",
            "remove_element",
            "set_attribute",
            "set_command"
          ]
        },
        "element": {
          "type": "string",
          "description": "Item name; for set_properties omit or pass Form to change the form."
        },
        "kind": {
          "type": "string",
          "description": "add_element: the kind of item to create."
        },
        "name": {
          "type": "string",
          "description": "set_attribute, set_command: the attribute or command name."
        },
        "type": {
          "type": "string",
          "description": "set_attribute: the type spelling, for example string(100) or CatalogRef.Организации."
        },
        "title": {
          "description": "set_attribute, set_command: a string (ru) or { ru, en }; null removes it.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "tooltip": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "action": {
          "type": "string",
          "description": "set_command: the handler procedure name."
        },
        "shortcut": {
          "type": "string",
          "description": "set_command: for example Ctrl+Enter or F5."
        },
        "representation": {
          "type": "string",
          "enum": [
            "Auto",
            "Text",
            "Picture",
            "TextPicture"
          ]
        },
        "modifies_saved_data": {
          "type": "boolean"
        },
        "current_row_use": {
          "type": "string",
          "enum": [
            "Auto",
            "Use",
            "DontUse"
          ]
        },
        "main": {
          "type": "boolean",
          "description": "set_attribute: the main attribute of the form."
        },
        "saved_data": {
          "type": "boolean"
        },
        "fill_check": {
          "type": "string",
          "enum": [
            "ShowError",
            "DontCheck"
          ]
        },
        "columns": {
          "type": "array",
          "description": "set_attribute: columns of a ValueTable or ValueTree attribute, [{ name, type, title, remove }]; ids are numbered inside the attribute.",
          "items": {
            "type": "object"
          }
        },
        "remove": {
          "type": "boolean",
          "description": "set_attribute, set_command: delete the attribute or command."
        },
        "properties": {
          "type": "object",
          "description": "set_properties: {PropertyNode: value}; null resets to the default.",
          "additionalProperties": true
        },
        "into": {
          "type": "string",
          "description": "move_element: target container name or Form."
        },
        "after": {
          "type": "string",
          "description": "move_element: place after this sibling."
        },
        "before": {
          "type": "string",
          "description": "move_element: place before this sibling."
        },
        "force": {
          "type": "boolean",
          "description": "remove_element: remove even when other nodes refer to the item."
        }
      },
      "required": [
        "path",
        "operation"
      ]
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true
    }
  }
] as const;
