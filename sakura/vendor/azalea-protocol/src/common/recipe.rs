use azalea_buf::{AzBuf, AzBufVar, BufReadError};
use azalea_inventory::{DataComponentPatch, ItemStack, ItemStackData};
use azalea_registry::{
    HolderSet,
    builtin::{DataComponentKind, ItemKind},
    data::TrimPattern,
    identifier::Identifier,
};
use std::io::{self, Cursor, Write};

/// [`azalea_registry::builtin::RecipeDisplay`]
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub enum RecipeDisplayData {
    Shapeless(ShapelessCraftingRecipeDisplay),
    Shaped(ShapedCraftingRecipeDisplay),
    Furnace(FurnaceRecipeDisplay),
    Stonecutter(StonecutterRecipeDisplay),
    Smithing(SmithingRecipeDisplay),
}

#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct ShapelessCraftingRecipeDisplay {
    pub ingredients: Vec<SlotDisplayData>,
    pub result: SlotDisplayData,
    pub crafting_station: SlotDisplayData,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct ShapedCraftingRecipeDisplay {
    #[var]
    pub width: u32,
    #[var]
    pub height: u32,
    pub ingredients: Vec<SlotDisplayData>,
    pub result: SlotDisplayData,
    pub crafting_station: SlotDisplayData,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct FurnaceRecipeDisplay {
    pub ingredient: SlotDisplayData,
    pub fuel: SlotDisplayData,
    pub result: SlotDisplayData,
    pub crafting_station: SlotDisplayData,
    #[var]
    pub duration: u32,
    pub experience: f32,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct StonecutterRecipeDisplay {
    pub input: SlotDisplayData,
    pub result: SlotDisplayData,
    pub crafting_station: SlotDisplayData,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct SmithingRecipeDisplay {
    pub template: SlotDisplayData,
    pub base: SlotDisplayData,
    pub addition: SlotDisplayData,
    pub result: SlotDisplayData,
    pub crafting_station: SlotDisplayData,
}

#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct Ingredient {
    pub allowed: HolderSet<ItemKind, Identifier>,
}

/// [`azalea_registry::builtin::SlotDisplay`]
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub enum SlotDisplayData {
    Empty,
    AnyFuel,
    WithAnyPotion(Box<WithAnyPotionSlotDisplay>),
    OnlyWithComponent(Box<OnlyWithComponentSlotDisplay>),
    Item(ItemSlotDisplay),
    ItemStack(ItemStackSlotDisplay),
    Tag(TagSlotDisplay),
    Dyed(Box<DyedSlotDemo>),
    SmithingTrim(Box<SmithingTrimDemoSlotDisplay>),
    WithRemainder(Box<WithRemainderSlotDisplay>),
    Composite(CompositeSlotDisplay),
}

#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct WithAnyPotionSlotDisplay {
    pub contents: SlotDisplayData,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct OnlyWithComponentSlotDisplay {
    pub contents: SlotDisplayData,
    pub component: DataComponentKind,
}

#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct ItemSlotDisplay {
    pub item: ItemKind,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ItemStackSlotDisplay {
    pub stack: ItemStack,
}

// Minecraft26.1 uses ItemStackTemplate here, not the inventory ItemStack
// codec: registry item ID precedes count, followed by the component patch.
impl AzBuf for ItemStackSlotDisplay {
    fn azalea_read(buf: &mut Cursor<&[u8]>) -> Result<Self, BufReadError> {
        let kind = ItemKind::azalea_read(buf)?;
        let count = i32::azalea_read_var(buf)?;
        let component_patch = DataComponentPatch::azalea_read(buf)?;
        Ok(Self {
            stack: ItemStackData {
                kind,
                count,
                component_patch,
            }
            .into(),
        })
    }
    fn azalea_write(&self, buf: &mut impl Write) -> io::Result<()> {
        let Some(stack) = self.stack.as_present() else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Recipe item templates cannot be empty",
            ));
        };
        stack.kind.azalea_write(buf)?;
        stack.count.azalea_write_var(buf)?;
        stack.component_patch.azalea_write(buf)
    }
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct DyedSlotDemo {
    pub dye: SlotDisplayData,
    pub target: SlotDisplayData,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct TagSlotDisplay {
    pub tag: Identifier,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct SmithingTrimDemoSlotDisplay {
    pub base: SlotDisplayData,
    pub material: SlotDisplayData,
    pub pattern: TrimPattern,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct WithRemainderSlotDisplay {
    pub input: SlotDisplayData,
    pub remainder: SlotDisplayData,
}
#[derive(AzBuf, Clone, Debug, PartialEq)]
pub struct CompositeSlotDisplay {
    pub contents: Vec<SlotDisplayData>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recipe_template_decodes_item_before_count_without_changing_inventory_codec() {
        let mut wire = Vec::new();
        ItemKind::OakPlanks.azalea_write(&mut wire).unwrap();
        4i32.azalea_write_var(&mut wire).unwrap();
        DataComponentPatch::default()
            .azalea_write(&mut wire)
            .unwrap();
        let decoded = ItemStackSlotDisplay::azalea_read(&mut Cursor::new(&wire)).unwrap();
        assert_eq!(decoded.stack.kind(), ItemKind::OakPlanks);
        assert_eq!(decoded.stack.count(), 4);
        let mut encoded = Vec::new();
        decoded.azalea_write(&mut encoded).unwrap();
        assert_eq!(encoded, wire);
    }
}
