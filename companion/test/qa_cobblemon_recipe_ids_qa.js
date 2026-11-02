'use strict'
// QA-only correction matching upstream minecraft-data PR #1291.
// Never patch production dependencies, skip recipes, or relax parser limits.
const mcData=require('minecraft-data')('1.21.1')
function mapping(){
  const schemas=mcData.protocol.play.toClient.types.packet_declare_recipes
  const recipes=schemas[1].find(f=>f.name==='recipes')
  const fields=recipes.type[1].type[1]
  const serializer=fields.find(f=>f.name==='type').type[1].mappings
  const body=fields.find(f=>f.name==='data').type[1].fields
  return {serializer,body}
}
function applyUpstreamQaRecipeIds(){
  const {serializer,body}=mapping()
  if(Object.keys(serializer).length!==24||
     serializer['11']!=='minecraft:crafting_special_banneraddpattern'||
     serializer['23']!=='minecraft:crafting_decorated_pot'||
     body['minecraft:crafting_special_banneraddpattern']!=='minecraft_simple_recipe_format')
    throw Error('Upstream QA recipe fix must not apply to unknown protocol data')
  delete serializer['11']
  for(let i=12;i<=23;i++){
    serializer[String(i-1)]=serializer[String(i)]
    delete serializer[String(i)]
  }
  delete body['minecraft:crafting_special_banneraddpattern']
  if(Object.keys(serializer).length!==23||
     serializer['22']!=='minecraft:crafting_decorated_pot'||
     Object.values(serializer).includes('minecraft:crafting_special_banneraddpattern'))
    throw Error('Upstream QA recipe serializer fix failed self-check')
  return true
}
module.exports={applyUpstreamQaRecipeIds,mapping}
