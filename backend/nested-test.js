const fs = require('fs');
const xml2js = require('xml2js');

console.log('Testing nested XML structure...');

const xmlContent = fs.readFileSync('../HIPDM.pdm', 'utf-8');

xml2js.parseString(xmlContent, { explicitArray: false }, (err, result) => {
  if (err) {
    console.error('Parse error:', err);
    return;
  }

  console.log('Root keys:', Object.keys(result));

  let model = result.Model;
  console.log('Initial model found:', !!model);

  // 处理嵌套结构
  if (model && model['o:RootObject'] && model['o:RootObject']['c:Children'] && model['o:RootObject']['c:Children']['o:Model']) {
    model = model['o:RootObject']['c:Children']['o:Model'];
    console.log('Successfully navigated to nested model');
  }

  if (model) {
    console.log('Model keys:', Object.keys(model));

    const tablesNode = model['c:Tables'];
    const referencesNode = model['c:References'];

    console.log('Tables node found:', !!tablesNode);
    console.log('References node found:', !!referencesNode);

    if (tablesNode && tablesNode['o:Table']) {
      const tableList = Array.isArray(tablesNode['o:Table']) ? tablesNode['o:Table'] : [tablesNode['o:Table']];
      console.log('Table count:', tableList.length);
    }

    if (referencesNode && referencesNode['o:Reference']) {
      const refList = Array.isArray(referencesNode['o:Reference']) ? referencesNode['o:Reference'] : [referencesNode['o:Reference']];
      console.log('Reference count:', refList.length);
    }
  }
});