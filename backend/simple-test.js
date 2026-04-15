const fs = require('fs');
const xml2js = require('xml2js');

console.log('Starting PDM parse test...');

const xmlContent = fs.readFileSync('../HIPDM.pdm', 'utf-8');
console.log('XML file loaded, length:', xmlContent.length);

// 简单检查 XML 结构
const modelMatch = xmlContent.match(/<o:Model[^>]*>/);
console.log('Found o:Model tag:', !!modelMatch);

const tablesMatch = xmlContent.match(/<c:Tables>/);
console.log('Found c:Tables tag:', !!tablesMatch);

const referencesMatch = xmlContent.match(/<c:References>/);
console.log('Found c:References tag:', !!referencesMatch);

// 直接解析 XML 并检查结构
xml2js.parseString(xmlContent, { explicitArray: false }, (err, result) => {
  if (err) {
    console.error('XML parse error:', err);
    return;
  }

  console.log('XML parsed successfully');
  console.log('Root keys:', Object.keys(result));

  // 检查嵌套结构
  const rootObject = result.Model;
  console.log('Root object keys:', Object.keys(rootObject || {}));

  if (rootObject && rootObject['o:RootObject']) {
    const rootObj = rootObject['o:RootObject'];
    console.log('RootObject keys:', Object.keys(rootObj));

    if (rootObj['c:Children']) {
      const children = rootObj['c:Children'];
      console.log('Children keys:', Object.keys(children));

      if (children['o:Model']) {
        const model = children['o:Model'];
        console.log('Model keys:', Object.keys(model));

        // 检查 Tables 和 References
        if (model['c:Tables']) {
          console.log('Found c:Tables in model');
          const tables = model['c:Tables'];
          console.log('Tables keys:', Object.keys(tables));

          if (tables['o:Table']) {
            const tableList = Array.isArray(tables['o:Table']) ? tables['o:Table'] : [tables['o:Table']];
            console.log('Table count:', tableList.length);
            console.log('First table keys:', Object.keys(tableList[0] || {}));
          }
        }

        if (model['c:References']) {
          console.log('Found c:References in model');
          const refs = model['c:References'];
          console.log('References keys:', Object.keys(refs));

          if (refs['o:Reference']) {
            const refList = Array.isArray(refs['o:Reference']) ? refs['o:Reference'] : [refs['o:Reference']];
            console.log('Reference count:', refList.length);
            console.log('First reference keys:', Object.keys(refList[0] || {}));
          }
        }
      }
    }
  }
});