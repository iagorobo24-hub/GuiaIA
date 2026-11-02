'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {applyUpstreamQaRecipeIds,mapping}=require('./qa_cobblemon_recipe_ids_qa')
test('QA-only correction matches minecraft-data PR #1291 and leaves bounds intact',()=>{
  const {serializer,body}=mapping()
  const source={...serializer}
  assert.equal(source['11'],'minecraft:crafting_special_banneraddpattern')
  assert.equal(source['23'],'minecraft:crafting_decorated_pot')
  assert.equal(applyUpstreamQaRecipeIds(),true)
  assert.equal(Object.keys(serializer).length,23)
  assert.equal(serializer['11'],source['12'])
  assert.equal(serializer['15'],source['16'])
  assert.equal(serializer['22'],source['23'])
  assert.equal(serializer['23'],undefined)
  assert.equal(body['minecraft:crafting_special_banneraddpattern'],undefined)
  assert.throws(()=>applyUpstreamQaRecipeIds(),/unknown protocol data/)
})
