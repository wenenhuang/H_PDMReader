const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const ExcelJS = require('exceljs');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 文件上传配置
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// 存储解析的数据
let parsedData = { tables: [], relationships: [] };

// 解析 PDM 文件
function parsePDM(xmlContent) {
  const getValue = (node, keys) => {
    if (!node) return undefined
    for (const key of keys) {
      if (node[key] !== undefined) return node[key]
    }
    return undefined
  }

  const getRefId = node => {
    if (!node) return undefined
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return getRefId(node[0])
    if (node['$']?.Ref) return node['$'].Ref
    if (node['$']?.ref) return node['$'].ref
    if (node.Ref) return node.Ref
    if (node.ref) return node.ref
    if (node['a:Ref']) return node['a:Ref']
    if (node['o:Ref']) return node['o:Ref']
    if (node['c:Ref']) return node['c:Ref']

    for (const key of Object.keys(node)) {
      const inner = getRefId(node[key])
      if (inner) return inner
    }
    return undefined
  }

  const normalizeId = node => {
    if (!node) return undefined
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return normalizeId(node[0])
    if (node['$']?.Id) return node['$'].Id
    if (node['$']?.id) return node['$'].id
    if (node.Id) return node.Id
    if (node.id) return node.id
    return getValue(node, ['Code', 'a:Code', 'o:Code', 'Name', 'a:Name', 'o:Name'])
  }

  const findDescendant = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined
    if (predicate(node)) return node

    for (const key of Object.keys(node)) {
      const child = node[key]
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = findDescendant(item, predicate)
          if (found) return found
        }
      } else {
        const found = findDescendant(child, predicate)
        if (found) return found
      }
    }
    return undefined
  }

  const hasModelContent = node => {
    if (!node || typeof node !== 'object') return false
    return Boolean(
      node.Tables || node['o:Tables'] || node['a:Tables'] || node['c:Tables'] ||
      node.References || node['o:References'] || node['a:References'] || node['c:References']
    )
  }

  return new Promise((resolve, reject) => {
    xml2js.parseString(xmlContent, { explicitArray: false }, (err, result) => {
      if (err) {
        reject(err)
        return
      }

      const tables = []
      const relationships = []

      let model = result.Model || result['o:Model'] || result['a:Model'] || result['c:Model']
      if (!model) {
        model = findDescendant(result, hasModelContent)
      }

      // 处理嵌套结构：Model -> o:RootObject -> c:Children -> o:Model
      if (model && model['o:RootObject'] && model['o:RootObject']['c:Children'] && model['o:RootObject']['c:Children']['o:Model']) {
        model = model['o:RootObject']['c:Children']['o:Model']
        console.log('Found nested model structure');
      } else if (model && model['c:Children'] && model['c:Children']['o:Model']) {
        // 另一种可能的嵌套：Model -> c:Children -> o:Model
        model = model['c:Children']['o:Model']
        console.log('Found simple nested model structure');
      }

      const tablesNode = model?.Tables || model?.['o:Tables'] || model?.['a:Tables'] || model?.['c:Tables']
      const tableNodes = tablesNode?.Table || tablesNode?.['o:Table'] || tablesNode?.['a:Table'] || tablesNode?.['c:Table']

      if (tableNodes) {
        const tableList = Array.isArray(tableNodes) ? tableNodes : [tableNodes]
        tableList.forEach(table => {
          const name = getValue(table, ['Name', 'a:Name', 'o:Name']) || ''
          const code = getValue(table, ['Code', 'a:Code', 'o:Code']) || ''
          const tableInfo = {
            id: normalizeId(table) || code || name,
            name,
            code,
            comment: getValue(table, ['Comment', 'a:Comment', 'o:Comment']) || '',
            fields: []
          }

          const columnsNode = table.Columns || table['o:Columns'] || table['a:Columns'] || table['c:Columns']
          const columnNodes = columnsNode?.Column || columnsNode?.['o:Column'] || columnsNode?.['a:Column'] || columnsNode?.['c:Column']
          if (columnNodes) {
            const columnList = Array.isArray(columnNodes) ? columnNodes : [columnNodes]
            columnList.forEach(column => {
              const mandatoryValue = getValue(column, ['Mandatory', 'a:Mandatory', 'o:Mandatory'])
              const field = {
                id: normalizeId(column),
                name: getValue(column, ['Name', 'a:Name', 'o:Name']) || '',
                code: getValue(column, ['Code', 'a:Code', 'o:Code']) || '',
                type: getValue(column, ['DataType', 'a:DataType', 'o:DataType']) || '',
                length: getValue(column, ['Length', 'a:Length', 'o:Length']) || '',
                nullable: mandatoryValue !== '1' && mandatoryValue !== true && mandatoryValue !== 'true',
                primaryKey: getValue(column, ['PrimaryKey', 'a:PrimaryKey', 'o:PrimaryKey']) === '1' || getValue(column, ['PrimaryKey', 'a:PrimaryKey', 'o:PrimaryKey']) === true || getValue(column, ['PrimaryKey', 'a:PrimaryKey', 'o:PrimaryKey']) === 'true',
                comment: getValue(column, ['Comment', 'a:Comment', 'o:Comment']) || ''
              }
              tableInfo.fields.push(field)
            })
          }

          tables.push(tableInfo)
        })
      }

      const tableMapById = new Map()
      const tableMapByName = new Map()
      const tableMapByCode = new Map()
      tables.forEach(table => {
        if (table.id) tableMapById.set(table.id, table.id)
        if (table.name) tableMapByName.set(table.name, table.id)
        if (table.code) tableMapByCode.set(table.code, table.id)
      })

      const referencesNode = model?.References || model?.['o:References'] || model?.['a:References'] || model?.['c:References']
      const referenceNodes = referencesNode?.Reference || referencesNode?.['o:Reference'] || referencesNode?.['a:Reference'] || referencesNode?.['c:Reference']
      if (referenceNodes) {
        const refList = Array.isArray(referenceNodes) ? referenceNodes : [referenceNodes]
        refList.forEach(ref => {
          let parentRef = getRefId(ref.ParentTable || ref['a:ParentTable'] || ref['o:ParentTable'] || ref['c:ParentTable'] || ref.ParentTableRef || ref['$']?.ParentTableRef || ref['$']?.parentTableRef)
          let childRef = getRefId(ref.ChildTable || ref['a:ChildTable'] || ref['o:ChildTable'] || ref['c:ChildTable'] || ref.ChildTableRef || ref['$']?.ChildTableRef || ref['$']?.childTableRef)

          if (parentRef && !tableMapById.has(parentRef)) {
            parentRef = tableMapByCode.get(parentRef) || tableMapByName.get(parentRef) || parentRef
          }
          if (childRef && !tableMapById.has(childRef)) {
            childRef = tableMapByCode.get(childRef) || tableMapByName.get(childRef) || childRef
          }

          if (parentRef && childRef) {
            const rel = {
              parentTable: parentRef,
              childTable: childRef,
              name: getValue(ref, ['Name', 'a:Name', 'o:Name', 'Code', 'a:Code', 'o:Code']) || '',
              joins: []
            }

            // 解析字段级连接关系
            const joinsNode = ref.Joins || ref['o:Joins'] || ref['a:Joins'] || ref['c:Joins']
            const joinNodes = joinsNode?.ReferenceJoin || joinsNode?.['o:ReferenceJoin'] || joinsNode?.['a:ReferenceJoin'] || joinsNode?.['c:ReferenceJoin']
            if (joinNodes) {
              const joinList = Array.isArray(joinNodes) ? joinNodes : [joinNodes]
              joinList.forEach(join => {
                const pCol = getRefId(join.Object1 || join['c:Object1'])
                const cCol = getRefId(join.Object2 || join['c:Object2'])
                if (pCol && cCol) {
                  rel.joins.push({ parentColumn: pCol, childColumn: cCol })
                }
              })
            }
            relationships.push(rel)
          }
        })
      }

      if (relationships.length === 0) {
        const inferKey = (code) => typeof code === 'string' ? code.trim().toLowerCase() : ''
        const tableCodes = tables.map(table => ({ id: table.id, code: inferKey(table.code), name: inferKey(table.name) }))

        tables.forEach(table => {
          table.fields.forEach(field => {
            const fieldCode = inferKey(field.code)
            if (!fieldCode || !fieldCode.endsWith('_id')) return
            const target = fieldCode.slice(0, -3)
            const matched = tableCodes.find(item => item.code === target || item.name === target)
            if (matched && matched.id && matched.id !== table.id) {
              relationships.push({
                parentTable: matched.id,
                childTable: table.id,
                name: `${table.code || table.name}.${field.code}`
              })
            }
          })
        })
      }

      resolve({ tables, relationships })
    })
  })
}

// 上传路由
app.post('/api/upload', upload.single('pdmFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const xmlContent = req.file.buffer.toString('utf-8');
    parsedData = await parsePDM(xmlContent);

    res.json(parsedData);
  } catch (error) {
    console.error('Error parsing PDM:', error);
    res.status(500).json({ error: 'Failed to parse PDM file' });
  }
});

// 获取数据
app.get('/api/data', (req, res) => {
  res.json(parsedData);
});

// 导出 Excel
app.get('/api/export/excel', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data Dictionary');

    // 表头
    worksheet.columns = [
      { header: '表名', key: 'tableName', width: 20 },
      { header: '表注释', key: 'tableComment', width: 30 },
      { header: '字段名', key: 'fieldName', width: 20 },
      { header: '类型', key: 'type', width: 15 },
      { header: '长度', key: 'length', width: 10 },
      { header: '非空', key: 'nullable', width: 10 },
      { header: '主键', key: 'primaryKey', width: 10 },
      { header: '注释', key: 'comment', width: 30 }
    ];

    // 数据
    parsedData.tables.forEach(table => {
      table.fields.forEach(field => {
        worksheet.addRow({
          tableName: table.name,
          tableComment: table.comment,
          fieldName: field.name,
          type: field.type,
          length: field.length,
          nullable: field.nullable ? '否' : '是',
          primaryKey: field.primaryKey ? '是' : '否',
          comment: field.comment
        });
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=data-dictionary.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting Excel:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

// 导出 Markdown
app.get('/api/export/markdown', (req, res) => {
  try {
    let markdown = '# 数据字典\n\n';

    parsedData.tables.forEach(table => {
      markdown += `## ${table.name}\n\n`;
      if (table.comment) {
        markdown += `${table.comment}\n\n`;
      }
      markdown += '| 字段名 | 类型 | 长度 | 非空 | 主键 | 注释 |\n';
      markdown += '|--------|------|------|------|------|------|\n';
      table.fields.forEach(field => {
        markdown += `| ${field.name} | ${field.type} | ${field.length} | ${field.nullable ? '否' : '是'} | ${field.primaryKey ? '是' : '否'} | ${field.comment} |\n`;
      });
      markdown += '\n';
    });

    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', 'attachment; filename=data-dictionary.md');
    res.send(markdown);
  } catch (error) {
    console.error('Error exporting Markdown:', error);
    res.status(500).json({ error: 'Failed to export Markdown' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});