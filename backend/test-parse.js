const fs = require('fs');
const xml2js = require('xml2js');

// 复制解析逻辑
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

      // 处理嵌套结构
      if (model && model['o:RootObject'] && model['o:RootObject']['c:Children'] && model['o:RootObject']['c:Children']['o:Model']) {
        model = model['o:RootObject']['c:Children']['o:Model']
        console.log('Found nested model structure');
      } else if (model && model['c:Children'] && model['c:Children']['o:Model']) {
        model = model['c:Children']['o:Model']
        console.log('Found simple nested model structure');
      }

      console.log('Found model:', !!model)

      const tablesNode = model?.Tables || model?.['o:Tables'] || model?.['a:Tables'] || model?.['c:Tables']
      const tableNodes = tablesNode?.Table || tablesNode?.['o:Table'] || tablesNode?.['a:Table'] || tablesNode?.['c:Table']

      if (tableNodes) {
        const tableList = Array.isArray(tableNodes) ? tableNodes : [tableNodes]
        tableList.forEach((table, index) => {
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
        refList.forEach((ref, index) => {
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

      console.log('Final results:')
      console.log('Tables:', tables.length)
      console.log('Relationships:', relationships.length)
      const relationshipsWithJoins = relationships.filter(r => r.joins.length > 0).length
      console.log('Relationships with field joins:', relationshipsWithJoins)

      resolve({ tables, relationships })
    })
  })
}

// 测试解析
const xmlContent = fs.readFileSync('../HIPDM.pdm', 'utf-8');
parsePDM(xmlContent).then(result => {
  console.log('Parse successful!');
  console.log('Tables found:', result.tables.length);
  console.log('Relationships found:', result.relationships.length);
}).catch(err => {
  console.error('Parse failed:', err);
});
