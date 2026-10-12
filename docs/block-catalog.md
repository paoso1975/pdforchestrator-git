# Catalogo dei blocchi

Generato dal registry condiviso. Rigenerare con `npm run docs:blocks`; non modificare manualmente.

## `input.pdf@1.0.0` — Input PDF

Categoria: Input. Icona Lucide: `FileInput`. Handler: `input.pdf` (orchestrator).

Porte input: nessuna.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{
  "parameter": "documento"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "parameter": {
      "default": "documento",
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "parameter"
  ],
  "additionalProperties": false
}
```

## `input.pdf-list@1.0.0` — Input multiplo PDF

Categoria: Input. Icona Lucide: `FileInput`. Handler: `input.pdf-list` (orchestrator).

Porte input: nessuna.
Porte output: `pdfs: documentList`, `success: control`, `error: control`.

Default:

```json
{
  "parameter": "documenti"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "parameter": {
      "default": "documenti",
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "parameter"
  ],
  "additionalProperties": false
}
```

## `output.pdf@1.1.0` — Output PDF multiplo

Categoria: Output. Icona Lucide: `FileOutput`. Handler: `output.pdf` (orchestrator).

Porte input: `run: control (multiplo)`, `pdf: document`, `documents: documentList`.
Porte output: `pdf: document`, `documents: documentList`, `success: control`, `error: control`.

Default:

```json
{
  "filename": "output.pdf"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "filename": {
      "default": "output.pdf",
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  },
  "required": [
    "filename"
  ],
  "additionalProperties": false
}
```

## `pdf.output@1.0.0` — Output file PDF

Categoria: Output. Icona Lucide: `FileOutput`. Handler: `pdf.output` (orchestrator).

Porte input: `run: control (multiplo)`, `document: document (obbligatorio)`.
Porte output: `artifact: object`, `manifest: object`, `success: control`, `error: control`.

Default:

```json
{
  "filenameTemplate": "{basename}.pdf",
  "collisionPolicy": "rename",
  "contentType": "application/pdf"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "filenameTemplate": {
      "default": "{basename}.pdf",
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "collisionPolicy": {
      "default": "rename",
      "type": "string",
      "enum": [
        "error",
        "rename",
        "overwrite"
      ]
    },
    "contentType": {
      "default": "application/pdf",
      "type": "string",
      "const": "application/pdf"
    }
  },
  "required": [
    "filenameTemplate",
    "collisionPolicy",
    "contentType"
  ],
  "additionalProperties": false
}
```

## `pdf.merge@1.2.0` — Unisci PDF

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.merge` (python).

Porte input: `run: control (multiplo)`, `pdfs: documentList (obbligatorio)`.
Porte output: `pdf: document`, `totalPages: number`, `pageMap: array`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "files": {
      "minItems": 1,
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "fileRef": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "filename": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255
          },
          "order": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "fileRef",
          "filename",
          "order"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "files"
  ],
  "additionalProperties": false
}
```

## `pdf.split@1.1.0` — Dividi PDF

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.split` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `documents: documentList`, `totalPages: number`, `success: control`, `error: control`.

Default:

```json
{
  "mode": "documents",
  "filenameTemplate": "{basename}-{index}.pdf"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "document",
        "documents"
      ]
    },
    "ranges": {
      "minItems": 1,
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "daPagina": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "aPagina": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "daPagina",
          "aPagina"
        ],
        "additionalProperties": false
      }
    },
    "filenameTemplate": {
      "default": "{basename}-{index}.pdf",
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "required": [
    "mode",
    "ranges",
    "filenameTemplate"
  ],
  "additionalProperties": false
}
```

## `pdf.extract-pages@1.0.0` — Estrai pagine

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.extract-pages` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "pages": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    }
  },
  "required": [
    "pages"
  ],
  "additionalProperties": false
}
```

## `pdf.delete-pages@1.1.0` — Elimina pagine

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.delete-pages` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{
  "deleteCurrentPage": false
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "pages": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    },
    "deleteCurrentPage": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "deleteCurrentPage"
  ],
  "additionalProperties": false
}
```

## `pdf.page.delete@1.0.0` — Elimina pagine selezionate

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.page.delete` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `deletedPages: array`, `deletedPageIds: array`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "page": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "pages": {
      "minItems": 1,
      "maxItems": 1000,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    },
    "pageId": {
      "type": "string",
      "pattern": "^[a-f0-9]{16}:page:[1-9][0-9]*$"
    }
  },
  "additionalProperties": false
}
```

## `pdf.page.insert@1.0.0` — Inserisci pagine

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.page.insert` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`, `sources: documentList (obbligatorio)`.
Porte output: `pdf: document`, `insertedCount: number`, `pageMap: array`, `success: control`, `error: control`.

Default:

```json
{
  "position": "after"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "sourceFile": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "sourcePages": {
      "minItems": 1,
      "maxItems": 1000,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    },
    "targetPage": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "position": {
      "type": "string",
      "enum": [
        "before",
        "after"
      ]
    }
  },
  "required": [
    "sourceFile",
    "sourcePages",
    "targetPage",
    "position"
  ],
  "additionalProperties": false
}
```

## `pdf.convert.pdfa@1.0.0` — Converti PDF/A

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.convert.pdfa` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `validationReport: object`, `success: control`, `error: control`.

Default:

```json
{
  "target": "PDF/A-2b"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "enum": [
        "PDF/A-1b",
        "PDF/A-2b",
        "PDF/A-3b"
      ]
    }
  },
  "required": [
    "target"
  ],
  "additionalProperties": false
}
```

## `pdf.reorder-pages@1.1.0` — Riordina pagine

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.reorder-pages` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "orderPlan": {
      "type": "object",
      "properties": {
        "pages": {
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "currentPage": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              "outputPosition": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "currentPage",
              "outputPosition"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "pages"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "orderPlan"
  ],
  "additionalProperties": false
}
```

## `pdf.rotate@1.0.0` — Ruota pagine

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.rotate` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{
  "degrees": 90
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "degrees": {
      "default": 90,
      "type": "number"
    },
    "pages": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    }
  },
  "required": [
    "degrees"
  ],
  "additionalProperties": false
}
```

## `pdf.normalize-pages@1.0.0` — Normalizza pagine

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.normalize-pages` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{
  "pageSize": "A4",
  "orientation": "portrait",
  "fit": "contain"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "pageSize": {
      "type": "string",
      "enum": [
        "A4",
        "A3",
        "A5",
        "LETTER",
        "LEGAL"
      ]
    },
    "orientation": {
      "type": "string",
      "enum": [
        "portrait",
        "landscape"
      ]
    },
    "fit": {
      "type": "string",
      "enum": [
        "contain",
        "cover"
      ]
    }
  },
  "required": [
    "pageSize"
  ],
  "additionalProperties": false
}
```

## `pdf.page.normalize@1.0.0` — Normalizza formato ISO

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.page.normalize` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `modifiedPages: array`, `skippedPages: array`, `reason: object`, `success: control`, `error: control`.

Default:

```json
{
  "size": "A4",
  "orientation": "auto",
  "tolerancePercent": 2,
  "mode": "EXPAND_CANVAS",
  "anchor": "CENTER",
  "pageScope": "ALL"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "size": {
      "default": "A4",
      "type": "string",
      "enum": [
        "A3",
        "A4",
        "A5",
        "A6"
      ]
    },
    "orientation": {
      "default": "auto",
      "type": "string",
      "enum": [
        "auto",
        "portrait",
        "landscape"
      ]
    },
    "tolerancePercent": {
      "default": 2,
      "type": "number",
      "minimum": 0,
      "maximum": 10
    },
    "mode": {
      "default": "EXPAND_CANVAS",
      "type": "string",
      "enum": [
        "EXPAND_CANVAS",
        "SCALE_CONTENT"
      ]
    },
    "anchor": {
      "default": "CENTER",
      "type": "string",
      "enum": [
        "TOP_LEFT",
        "TOP_CENTER",
        "TOP_RIGHT",
        "CENTER_LEFT",
        "CENTER",
        "CENTER_RIGHT",
        "BOTTOM_LEFT",
        "BOTTOM_CENTER",
        "BOTTOM_RIGHT"
      ]
    },
    "pageScope": {
      "default": "ALL",
      "type": "string",
      "enum": [
        "ALL",
        "RANGE",
        "SELECTED"
      ]
    },
    "fromPage": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "toPage": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "pages": {
      "minItems": 1,
      "maxItems": 1000,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    }
  },
  "required": [
    "size",
    "orientation",
    "tolerancePercent",
    "mode",
    "anchor",
    "pageScope"
  ],
  "additionalProperties": false
}
```

## `pdf.detect-page-size@1.0.0` — Rileva formato pagina

Categoria: Analisi. Icona Lucide: `ScanLine`. Handler: `pdf.detect-page-size` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pages: array`, `success: control`, `error: control`.

Default:

```json
{
  "tolerancePoints": 0
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "tolerancePoints": {
      "default": 0,
      "type": "number",
      "minimum": 0
    }
  },
  "required": [
    "tolerancePoints"
  ],
  "additionalProperties": false
}
```

## `pdf.detect-qr@1.0.0` — Rileva QR

Categoria: Analisi. Icona Lucide: `ScanLine`. Handler: `pdf.detect-qr` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `codes: array`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "pages": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    }
  },
  "additionalProperties": false
}
```

## `pdf.qr.readAll@1.0.0` — Leggi tutti i QR

Categoria: Analisi. Icona Lucide: `ScanLine`. Handler: `pdf.qr.readAll` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `codes: array`, `pagesScanned: number`, `success: control`, `error: control`.

Default:

```json
{
  "startPage": 1,
  "dpi": 200,
  "preprocess": "none",
  "concurrency": 2
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "startPage": {
      "default": 1,
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "endPage": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "dpi": {
      "default": 200,
      "type": "integer",
      "minimum": 72,
      "maximum": 600
    },
    "preprocess": {
      "default": "none",
      "type": "string",
      "enum": [
        "none",
        "grayscale",
        "autocontrast"
      ]
    },
    "concurrency": {
      "default": 2,
      "type": "integer",
      "minimum": 1,
      "maximum": 8
    }
  },
  "required": [
    "startPage",
    "dpi",
    "preprocess",
    "concurrency"
  ],
  "additionalProperties": false
}
```

## `pdf.qr.readPage@1.0.0` — Leggi QR pagina

Categoria: Analisi. Icona Lucide: `ScanLine`. Handler: `pdf.qr.readPage` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `codes: array`, `found: boolean`, `count: number`, `success: control`, `error: control`.

Default:

```json
{
  "dpi": 200,
  "preprocess": "none"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "page": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "dpi": {
      "default": 200,
      "type": "integer",
      "minimum": 72,
      "maximum": 600
    },
    "preprocess": {
      "default": "none",
      "type": "string",
      "enum": [
        "none",
        "grayscale",
        "autocontrast"
      ]
    }
  },
  "required": [
    "page",
    "dpi",
    "preprocess"
  ],
  "additionalProperties": false
}
```

## `pdf.detect-barcode@1.0.0` — Rileva barcode

Categoria: Analisi. Icona Lucide: `ScanLine`. Handler: `pdf.detect-barcode` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `codes: array`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "formats": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "pages": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    }
  },
  "additionalProperties": false
}
```

## `pdf.remove-qr-pages@1.0.0` — Rimuovi pagine con QR

Categoria: Pagine. Icona Lucide: `Layers3`. Handler: `pdf.remove-qr-pages` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `removedPages: array`, `success: control`, `error: control`.

Default:

```json
{
  "match": "any"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "match": {
      "default": "any",
      "type": "string",
      "enum": [
        "any",
        "value"
      ]
    },
    "value": {
      "type": "string"
    }
  },
  "required": [
    "match"
  ],
  "additionalProperties": false
}
```

## `pdf.ocr@1.1.0` — OCR intervallo

Categoria: Analisi. Icona Lucide: `ScanLine`. Handler: `pdf.ocr` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `extractedText: string`, `success: control`, `error: control`.

Default:

```json
{
  "from": 1,
  "languages": [],
  "dpi": 300,
  "skipExistingText": true,
  "searchableOverlay": true,
  "includeExtractedText": false
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "from": {
      "default": 1,
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "to": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "languages": {
      "default": [],
      "maxItems": 8,
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Za-z0-9_]{2,16}$"
      }
    },
    "dpi": {
      "default": 300,
      "type": "integer",
      "minimum": 72,
      "maximum": 600
    },
    "skipExistingText": {
      "default": true,
      "type": "boolean"
    },
    "searchableOverlay": {
      "default": true,
      "type": "boolean"
    },
    "includeExtractedText": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "from",
    "languages",
    "dpi",
    "skipExistingText",
    "searchableOverlay",
    "includeExtractedText"
  ],
  "additionalProperties": false
}
```

## `pdf.read-metadata@1.0.0` — Leggi metadati

Categoria: Metadati. Icona Lucide: `FileText`. Handler: `pdf.read-metadata` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `metadata: object`, `success: control`, `error: control`.

Default:

```json
{
  "includeXmp": true
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "includeXmp": {
      "default": true,
      "type": "boolean"
    }
  },
  "required": [
    "includeXmp"
  ],
  "additionalProperties": false
}
```

## `pdf.write-metadata@1.0.0` — Scrivi metadati

Categoria: Metadati. Icona Lucide: `FileText`. Handler: `pdf.write-metadata` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "author": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    },
    "keywords": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "additionalProperties": false
}
```

## `pdf.bookmarks@1.0.0` — Segnalibri

Categoria: Metadati. Icona Lucide: `FileText`. Handler: `pdf.bookmarks` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{
  "bookmarks": []
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "bookmarks": {
      "default": [],
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string",
            "minLength": 1
          },
          "page": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "parent": {
            "type": "string"
          }
        },
        "required": [
          "title",
          "page"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "bookmarks"
  ],
  "additionalProperties": false
}
```

## `pdf.bookmark.add@1.0.0` — Aggiungi segnalibro

Categoria: Metadati. Icona Lucide: `FileText`. Handler: `pdf.bookmark.add` (python).

Porte input: `run: control (multiplo)`, `pdf: document (obbligatorio)`.
Porte output: `pdf: document`, `success: control`, `error: control`.

Default:

```json
{
  "level": 0
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "page": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "level": {
      "default": 0,
      "type": "integer",
      "minimum": 0,
      "maximum": 8
    },
    "parent": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    }
  },
  "required": [
    "page",
    "description",
    "level"
  ],
  "additionalProperties": false
}
```

## `flow.condition@1.0.0` — Condizione

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `flow.condition` (python).

Porte input: `run: control (multiplo)`, `value: document (obbligatorio)`.
Porte output: `true: control`, `false: control`, `value: document`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "conditionType": {
      "type": "string",
      "enum": [
        "qrFound",
        "pageCount",
        "pageSize",
        "textContains",
        "parameterComparison"
      ]
    },
    "path": {
      "type": "string"
    },
    "operator": {
      "type": "string",
      "enum": [
        "equals",
        "notEquals",
        "contains",
        "greaterThan",
        "lessThan",
        "exists"
      ]
    },
    "value": {
      "allOf": [
        {
          "$ref": "#/definitions/__schema0"
        }
      ]
    }
  },
  "required": [
    "conditionType",
    "operator"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema0"
          }
        }
      ]
    }
  }
}
```

## `logic.if@1.0.0` — IF / ELSE

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `logic.if` (python).

Porte input: `run: control (multiplo)`.
Porte output: `true: control`, `false: control`, `success: control`, `error: control`.

Default:

```json
{
  "operator": "eq",
  "leftType": "string",
  "rightType": "string",
  "caseSensitive": false,
  "nullBehavior": "equalOnly"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "leftType": {
      "type": "string",
      "enum": [
        "string",
        "number",
        "boolean",
        "array",
        "object"
      ],
      "description": "Tipo atteso per il valore left; il worker verifica anche il valore risolto."
    },
    "rightType": {
      "type": "string",
      "enum": [
        "string",
        "number",
        "boolean",
        "array",
        "object"
      ],
      "description": "Tipo atteso per right; per in/notIn deve essere array."
    },
    "left": {
      "description": "Valore costante o binding tipizzato da parametro API, output precedente o variabile.",
      "allOf": [
        {
          "$ref": "#/definitions/__schema0"
        }
      ]
    },
    "right": {
      "description": "Secondo valore o binding; non richiesto da isEmpty e isNull.",
      "allOf": [
        {
          "$ref": "#/definitions/__schema1"
        }
      ]
    },
    "operator": {
      "type": "string",
      "enum": [
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "notContains",
        "startsWith",
        "endsWith",
        "in",
        "notIn",
        "isEmpty",
        "isNull"
      ],
      "description": "Operatore dichiarativo del confronto."
    },
    "caseSensitive": {
      "default": false,
      "description": "Applica il confronto sensibile a maiuscole/minuscole per stringhe.",
      "type": "boolean"
    },
    "nullBehavior": {
      "default": "equalOnly",
      "description": "Regola applicata quando un operando è null.",
      "type": "string",
      "enum": [
        "equalOnly",
        "treatAsEmpty",
        "reject"
      ]
    }
  },
  "required": [
    "leftType",
    "rightType",
    "left",
    "operator",
    "caseSensitive",
    "nullBehavior"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema0"
              }
            ]
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema0"
              }
            ]
          }
        }
      ]
    },
    "__schema1": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema1"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema1"
          }
        }
      ]
    }
  }
}
```

## `logic.conditionGroup@1.0.0` — Condizioni composte

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `logic.conditionGroup` (python).

Porte input: `run: control (multiplo)`.
Porte output: `boolean: boolean`, `true: control`, `false: control`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "condition": {
      "$ref": "#/definitions/__schema0"
    }
  },
  "required": [
    "condition"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "leftType": {
              "type": "string",
              "enum": [
                "string",
                "number",
                "boolean",
                "array",
                "object"
              ],
              "description": "Tipo atteso per il valore left; il worker verifica anche il valore risolto."
            },
            "rightType": {
              "type": "string",
              "enum": [
                "string",
                "number",
                "boolean",
                "array",
                "object"
              ],
              "description": "Tipo atteso per right; per in/notIn deve essere array."
            },
            "left": {
              "description": "Valore costante o binding tipizzato da parametro API, output precedente o variabile.",
              "allOf": [
                {
                  "$ref": "#/definitions/__schema1"
                }
              ]
            },
            "right": {
              "description": "Secondo valore o binding; non richiesto da isEmpty e isNull.",
              "allOf": [
                {
                  "$ref": "#/definitions/__schema2"
                }
              ]
            },
            "operator": {
              "type": "string",
              "enum": [
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "contains",
                "notContains",
                "startsWith",
                "endsWith",
                "in",
                "notIn",
                "isEmpty",
                "isNull"
              ],
              "description": "Operatore dichiarativo del confronto."
            },
            "caseSensitive": {
              "default": false,
              "description": "Applica il confronto sensibile a maiuscole/minuscole per stringhe.",
              "type": "boolean"
            },
            "nullBehavior": {
              "default": "equalOnly",
              "description": "Regola applicata quando un operando è null.",
              "type": "string",
              "enum": [
                "equalOnly",
                "treatAsEmpty",
                "reject"
              ]
            },
            "kind": {
              "type": "string",
              "const": "comparison"
            }
          },
          "required": [
            "leftType",
            "rightType",
            "left",
            "operator",
            "caseSensitive",
            "nullBehavior",
            "kind"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "group"
            },
            "operator": {
              "type": "string",
              "enum": [
                "AND",
                "OR"
              ]
            },
            "conditions": {
              "minItems": 1,
              "maxItems": 16,
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema0"
              }
            }
          },
          "required": [
            "kind",
            "operator",
            "conditions"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "not"
            },
            "condition": {
              "$ref": "#/definitions/__schema0"
            }
          },
          "required": [
            "kind",
            "condition"
          ],
          "additionalProperties": false
        }
      ]
    },
    "__schema1": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema1"
              }
            ]
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema1"
              }
            ]
          }
        }
      ]
    },
    "__schema2": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema2"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema2"
          }
        }
      ]
    }
  }
}
```

## `loop.eachPage@1.0.0` — Per ogni pagina

Categoria: loop. Icona Lucide: `Repeat2`. Handler: `loop.eachPage` (orchestrator).

Porte input: `run: control (multiplo)`, `document: document (obbligatorio)`.
Porte output: `document: document`, `currentPage: number`, `pageId: string`, `pageCount: number`, `index: number`, `body: control`, `after: control`, `success: control`, `error: control`.

Default:

```json
{
  "start": 1,
  "step": 1,
  "maxIterations": 1000
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "start": {
      "default": 1,
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "end": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "step": {
      "default": 1,
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "maxIterations": {
      "default": 1000,
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000
    }
  },
  "required": [
    "start",
    "step",
    "maxIterations"
  ],
  "additionalProperties": false
}
```

## `loop.forEach@1.0.0` — Per ogni elemento

Categoria: loop. Icona Lucide: `Repeat2`. Handler: `loop.forEach` (orchestrator).

Porte input: `run: control (multiplo)`.
Porte output: `items: array`, `count: number`, `body: control`, `after: control`, `success: control`, `error: control`.

Default:

```json
{
  "itemType": "object",
  "columns": [],
  "maxIterations": 1000
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "source": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "const": "constant"
            },
            "value": {
              "$ref": "#/definitions/__schema0"
            }
          },
          "required": [
            "source",
            "value"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "const": "api"
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "path": {
              "maxItems": 16,
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            }
          },
          "required": [
            "source",
            "name"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "const": "node"
            },
            "nodeId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "port": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "path": {
              "maxItems": 16,
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            }
          },
          "required": [
            "source",
            "nodeId",
            "port"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "const": "variable"
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "scope": {
              "type": "string",
              "enum": [
                "workflow",
                "loop"
              ]
            },
            "path": {
              "maxItems": 16,
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            }
          },
          "required": [
            "source",
            "name"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "const": "loop"
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "path": {
              "maxItems": 16,
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            }
          },
          "required": [
            "source",
            "name"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "const": "expression"
            },
            "expression": {
              "$ref": "#/definitions/__schema1"
            }
          },
          "required": [
            "source",
            "expression"
          ],
          "additionalProperties": false
        }
      ],
      "description": "Binding a un array JSON o a una tabella { rows: [...] } (ad esempio codes di pdf.detect-qr)."
    },
    "itemType": {
      "default": "object",
      "description": "Tipo degli elementi dell'array.",
      "type": "string",
      "enum": [
        "string",
        "number",
        "boolean",
        "object",
        "array"
      ]
    },
    "columns": {
      "default": [],
      "description": "Colonne richieste e tipizzate per accedere a item.nomeColonna nel ramo body.",
      "maxItems": 64,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
          },
          "type": {
            "type": "string",
            "enum": [
              "string",
              "number",
              "boolean",
              "object",
              "array"
            ]
          }
        },
        "required": [
          "name",
          "type"
        ],
        "additionalProperties": false
      }
    },
    "filter": {
      "description": "Filtro dichiarativo applicato prima delle iterazioni; usare $item per elementi semplici.",
      "type": "object",
      "properties": {
        "column": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "operator": {
          "type": "string",
          "enum": [
            "eq",
            "neq",
            "gt",
            "gte",
            "lt",
            "lte",
            "contains",
            "notContains",
            "startsWith",
            "endsWith",
            "in",
            "notIn",
            "isEmpty",
            "isNull"
          ]
        },
        "value": {
          "allOf": [
            {
              "$ref": "#/definitions/__schema2"
            }
          ]
        }
      },
      "required": [
        "column",
        "operator"
      ],
      "additionalProperties": false
    },
    "maxIterations": {
      "default": 1000,
      "description": "Numero massimo di elementi elaborati dopo il filtro (da 1 a 1000).",
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000
    }
  },
  "required": [
    "source",
    "itemType",
    "columns",
    "maxIterations"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema0"
          }
        }
      ]
    },
    "__schema1": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "literal"
            },
            "value": {
              "$ref": "#/definitions/__schema0"
            }
          },
          "required": [
            "op",
            "value"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "path"
            },
            "root": {
              "type": "string",
              "enum": [
                "api",
                "nodes",
                "variables",
                "loop"
              ]
            },
            "path": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            }
          },
          "required": [
            "op",
            "root",
            "path"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "enum": [
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "contains"
              ]
            },
            "left": {
              "$ref": "#/definitions/__schema1"
            },
            "right": {
              "$ref": "#/definitions/__schema1"
            }
          },
          "required": [
            "op",
            "left",
            "right"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "enum": [
                "and",
                "or"
              ]
            },
            "args": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            }
          },
          "required": [
            "op",
            "args"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "not"
            },
            "value": {
              "$ref": "#/definitions/__schema1"
            }
          },
          "required": [
            "op",
            "value"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "add"
            },
            "args": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            }
          },
          "required": [
            "op",
            "args"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "concat"
            },
            "args": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            }
          },
          "required": [
            "op",
            "args"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "if"
            },
            "condition": {
              "$ref": "#/definitions/__schema1"
            },
            "then": {
              "$ref": "#/definitions/__schema1"
            },
            "else": {
              "$ref": "#/definitions/__schema1"
            }
          },
          "required": [
            "op",
            "condition",
            "then",
            "else"
          ],
          "additionalProperties": false
        }
      ]
    },
    "__schema2": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema2"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema2"
          }
        }
      ]
    }
  }
}
```

## `loop.while@1.0.0` — WHILE

Categoria: loop. Icona Lucide: `Repeat2`. Handler: `loop.while` (orchestrator).

Porte input: `run: control (multiplo)`.
Porte output: `iteration: number`, `body: control`, `after: control`, `success: control`, `error: control`.

Default:

```json
{
  "timeoutSeconds": 900
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "condition": {
      "description": "Condizione dichiarativa verificata a ogni iterazione.",
      "allOf": [
        {
          "$ref": "#/definitions/__schema0"
        }
      ]
    },
    "maxIterations": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000,
      "description": "Limite obbligatorio di iterazioni (1–1000)."
    },
    "timeoutSeconds": {
      "default": 900,
      "description": "Timeout complessivo del ciclo, in secondi (massimo 900).",
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 900
    }
  },
  "required": [
    "condition",
    "maxIterations",
    "timeoutSeconds"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "leftType": {
              "type": "string",
              "enum": [
                "string",
                "number",
                "boolean",
                "array",
                "object"
              ],
              "description": "Tipo atteso per il valore left; il worker verifica anche il valore risolto."
            },
            "rightType": {
              "type": "string",
              "enum": [
                "string",
                "number",
                "boolean",
                "array",
                "object"
              ],
              "description": "Tipo atteso per right; per in/notIn deve essere array."
            },
            "left": {
              "description": "Valore costante o binding tipizzato da parametro API, output precedente o variabile.",
              "allOf": [
                {
                  "$ref": "#/definitions/__schema1"
                }
              ]
            },
            "right": {
              "description": "Secondo valore o binding; non richiesto da isEmpty e isNull.",
              "allOf": [
                {
                  "$ref": "#/definitions/__schema2"
                }
              ]
            },
            "operator": {
              "type": "string",
              "enum": [
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "contains",
                "notContains",
                "startsWith",
                "endsWith",
                "in",
                "notIn",
                "isEmpty",
                "isNull"
              ],
              "description": "Operatore dichiarativo del confronto."
            },
            "caseSensitive": {
              "default": false,
              "description": "Applica il confronto sensibile a maiuscole/minuscole per stringhe.",
              "type": "boolean"
            },
            "nullBehavior": {
              "default": "equalOnly",
              "description": "Regola applicata quando un operando è null.",
              "type": "string",
              "enum": [
                "equalOnly",
                "treatAsEmpty",
                "reject"
              ]
            },
            "kind": {
              "type": "string",
              "const": "comparison"
            }
          },
          "required": [
            "leftType",
            "rightType",
            "left",
            "operator",
            "caseSensitive",
            "nullBehavior",
            "kind"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "group"
            },
            "operator": {
              "type": "string",
              "enum": [
                "AND",
                "OR"
              ]
            },
            "conditions": {
              "minItems": 1,
              "maxItems": 16,
              "type": "array",
              "items": {
                "allOf": [
                  {
                    "$ref": "#/definitions/__schema0"
                  }
                ]
              }
            }
          },
          "required": [
            "kind",
            "operator",
            "conditions"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "not"
            },
            "condition": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            }
          },
          "required": [
            "kind",
            "condition"
          ],
          "additionalProperties": false
        }
      ]
    },
    "__schema1": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema1"
              }
            ]
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema1"
              }
            ]
          }
        }
      ]
    },
    "__schema2": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema2"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema2"
          }
        }
      ]
    }
  }
}
```

## `loop.repeatUntil@1.0.0` — REPEAT UNTIL

Categoria: loop. Icona Lucide: `Repeat2`. Handler: `loop.repeatUntil` (orchestrator).

Porte input: `run: control (multiplo)`.
Porte output: `iteration: number`, `body: control`, `after: control`, `success: control`, `error: control`.

Default:

```json
{
  "timeoutSeconds": 900
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "condition": {
      "description": "Condizione dichiarativa verificata a ogni iterazione.",
      "allOf": [
        {
          "$ref": "#/definitions/__schema0"
        }
      ]
    },
    "maxIterations": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000,
      "description": "Limite obbligatorio di iterazioni (1–1000)."
    },
    "timeoutSeconds": {
      "default": 900,
      "description": "Timeout complessivo del ciclo, in secondi (massimo 900).",
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 900
    }
  },
  "required": [
    "condition",
    "maxIterations",
    "timeoutSeconds"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "leftType": {
              "type": "string",
              "enum": [
                "string",
                "number",
                "boolean",
                "array",
                "object"
              ],
              "description": "Tipo atteso per il valore left; il worker verifica anche il valore risolto."
            },
            "rightType": {
              "type": "string",
              "enum": [
                "string",
                "number",
                "boolean",
                "array",
                "object"
              ],
              "description": "Tipo atteso per right; per in/notIn deve essere array."
            },
            "left": {
              "description": "Valore costante o binding tipizzato da parametro API, output precedente o variabile.",
              "allOf": [
                {
                  "$ref": "#/definitions/__schema1"
                }
              ]
            },
            "right": {
              "description": "Secondo valore o binding; non richiesto da isEmpty e isNull.",
              "allOf": [
                {
                  "$ref": "#/definitions/__schema2"
                }
              ]
            },
            "operator": {
              "type": "string",
              "enum": [
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "contains",
                "notContains",
                "startsWith",
                "endsWith",
                "in",
                "notIn",
                "isEmpty",
                "isNull"
              ],
              "description": "Operatore dichiarativo del confronto."
            },
            "caseSensitive": {
              "default": false,
              "description": "Applica il confronto sensibile a maiuscole/minuscole per stringhe.",
              "type": "boolean"
            },
            "nullBehavior": {
              "default": "equalOnly",
              "description": "Regola applicata quando un operando è null.",
              "type": "string",
              "enum": [
                "equalOnly",
                "treatAsEmpty",
                "reject"
              ]
            },
            "kind": {
              "type": "string",
              "const": "comparison"
            }
          },
          "required": [
            "leftType",
            "rightType",
            "left",
            "operator",
            "caseSensitive",
            "nullBehavior",
            "kind"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "group"
            },
            "operator": {
              "type": "string",
              "enum": [
                "AND",
                "OR"
              ]
            },
            "conditions": {
              "minItems": 1,
              "maxItems": 16,
              "type": "array",
              "items": {
                "allOf": [
                  {
                    "$ref": "#/definitions/__schema0"
                  }
                ]
              }
            }
          },
          "required": [
            "kind",
            "operator",
            "conditions"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "not"
            },
            "condition": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            }
          },
          "required": [
            "kind",
            "condition"
          ],
          "additionalProperties": false
        }
      ]
    },
    "__schema1": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema1"
              }
            ]
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema1"
              }
            ]
          }
        }
      ]
    },
    "__schema2": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema2"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema2"
          }
        }
      ]
    }
  }
}
```

## `flow.break@1.0.0` — Interrompi ciclo

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `flow.break` (orchestrator).

Porte input: `run: control (multiplo)`.
Porte output: `break: control`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## `flow.continue@1.0.0` — Continua ciclo

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `flow.continue` (orchestrator).

Porte input: `run: control (multiplo)`.
Porte output: `continue: control`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## `flow.jumpPage@1.0.0` — Salta pagina

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `flow.jumpPage` (orchestrator).

Porte input: `run: control (multiplo)`.
Porte output: `jump: control`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "targetMode": {
      "type": "string",
      "enum": [
        "absolute",
        "relative"
      ],
      "description": "Pagina assoluta oppure spostamento relativo alla pagina corrente."
    },
    "value": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991,
      "description": "Pagina di destinazione 1-based (assoluto) oppure offset intero non nullo (relativo)."
    }
  },
  "required": [
    "targetMode",
    "value"
  ],
  "additionalProperties": false
}
```

## `data.lookup@1.0.0` — Cerca in elenco

Categoria: Analisi. Icona Lucide: `ScanLine`. Handler: `data.lookup` (python).

Porte input: `run: control (multiplo)`, `items: array`, `record: object`.
Porte output: `value: object`, `values: array`, `found: control`, `notFound: control`, `success: control`, `error: control`.

Default:

```json
{
  "result": "object",
  "cardinality": "first",
  "nullBehavior": "skip"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "column": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "valueType": {
      "type": "string",
      "enum": [
        "string",
        "number",
        "boolean",
        "object",
        "array",
        "null"
      ]
    },
    "operator": {
      "type": "string",
      "enum": [
        "exact",
        "contains",
        "range"
      ]
    },
    "value": {
      "allOf": [
        {
          "$ref": "#/definitions/__schema0"
        }
      ]
    },
    "min": {
      "type": "number"
    },
    "max": {
      "type": "number"
    },
    "result": {
      "default": "object",
      "type": "string",
      "enum": [
        "column",
        "object"
      ]
    },
    "resultColumn": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "cardinality": {
      "default": "first",
      "type": "string",
      "enum": [
        "first",
        "all"
      ]
    },
    "defaultValue": {
      "allOf": [
        {
          "$ref": "#/definitions/__schema0"
        }
      ]
    },
    "nullBehavior": {
      "default": "skip",
      "type": "string",
      "enum": [
        "match",
        "skip",
        "error"
      ]
    }
  },
  "required": [
    "column",
    "valueType",
    "operator",
    "result",
    "cardinality",
    "nullBehavior"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema0"
          }
        }
      ]
    }
  }
}
```

## `data.setVariable@1.0.0` — Imposta variabile

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `data.setVariable` (orchestrator).

Porte input: `run: control (multiplo)`.
Porte output: `value: object`, `success: control`, `error: control`.

Default:

```json
{}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
    },
    "valueType": {
      "type": "string",
      "enum": [
        "string",
        "number",
        "boolean",
        "object",
        "array"
      ]
    },
    "scope": {
      "type": "string",
      "enum": [
        "workflow",
        "loop"
      ]
    },
    "value": {
      "anyOf": [
        {
          "$ref": "#/definitions/__schema0"
        },
        {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "source": {
                  "type": "string",
                  "const": "constant"
                },
                "value": {
                  "$ref": "#/definitions/__schema1"
                }
              },
              "required": [
                "source",
                "value"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "source": {
                  "type": "string",
                  "const": "api"
                },
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "path": {
                  "maxItems": 16,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                }
              },
              "required": [
                "source",
                "name"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "source": {
                  "type": "string",
                  "const": "node"
                },
                "nodeId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "port": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "path": {
                  "maxItems": 16,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                }
              },
              "required": [
                "source",
                "nodeId",
                "port"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "source": {
                  "type": "string",
                  "const": "variable"
                },
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "scope": {
                  "type": "string",
                  "enum": [
                    "workflow",
                    "loop"
                  ]
                },
                "path": {
                  "maxItems": 16,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                }
              },
              "required": [
                "source",
                "name"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "source": {
                  "type": "string",
                  "const": "loop"
                },
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "path": {
                  "maxItems": 16,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                }
              },
              "required": [
                "source",
                "name"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "source": {
                  "type": "string",
                  "const": "expression"
                },
                "expression": {
                  "$ref": "#/definitions/__schema2"
                }
              },
              "required": [
                "source",
                "expression"
              ],
              "additionalProperties": false
            }
          ]
        }
      ]
    }
  },
  "required": [
    "name",
    "valueType",
    "scope",
    "value"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema0"
          }
        }
      ]
    },
    "__schema1": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema1"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/definitions/__schema1"
          }
        }
      ]
    },
    "__schema2": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "literal"
            },
            "value": {
              "$ref": "#/definitions/__schema1"
            }
          },
          "required": [
            "op",
            "value"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "path"
            },
            "root": {
              "type": "string",
              "enum": [
                "api",
                "nodes",
                "variables",
                "loop"
              ]
            },
            "path": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            }
          },
          "required": [
            "op",
            "root",
            "path"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "enum": [
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "contains"
              ]
            },
            "left": {
              "$ref": "#/definitions/__schema2"
            },
            "right": {
              "$ref": "#/definitions/__schema2"
            }
          },
          "required": [
            "op",
            "left",
            "right"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "enum": [
                "and",
                "or"
              ]
            },
            "args": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema2"
              }
            }
          },
          "required": [
            "op",
            "args"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "not"
            },
            "value": {
              "$ref": "#/definitions/__schema2"
            }
          },
          "required": [
            "op",
            "value"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "add"
            },
            "args": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema2"
              }
            }
          },
          "required": [
            "op",
            "args"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "concat"
            },
            "args": {
              "minItems": 1,
              "maxItems": 32,
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema2"
              }
            }
          },
          "required": [
            "op",
            "args"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "op": {
              "type": "string",
              "const": "if"
            },
            "condition": {
              "$ref": "#/definitions/__schema2"
            },
            "then": {
              "$ref": "#/definitions/__schema2"
            },
            "else": {
              "$ref": "#/definitions/__schema2"
            }
          },
          "required": [
            "op",
            "condition",
            "then",
            "else"
          ],
          "additionalProperties": false
        }
      ]
    }
  }
}
```

## `flow.merge@1.0.0` — Unisci flusso

Categoria: Flusso. Icona Lucide: `GitBranch`. Handler: `flow.merge` (python).

Porte input: `run: control (multiplo)`, `values: object (obbligatorio) (multiplo)`.
Porte output: `value: object`, `success: control`, `error: control`.

Default:

```json
{
  "strategy": "first"
}
```

Schema parametri:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "strategy": {
      "default": "first",
      "type": "string",
      "enum": [
        "first",
        "all"
      ]
    }
  },
  "required": [
    "strategy"
  ],
  "additionalProperties": false
}
```

