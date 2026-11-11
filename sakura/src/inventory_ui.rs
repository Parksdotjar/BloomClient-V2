//! Java 26.1 container geometry and input. Every operation is sent through the
//! server-authoritative inventory adapter; drawing never changes item stacks.
use super::gui::{GuiMetrics, Painter};
use crate::shared::{
    HotbarSlot, InventoryAction, InventoryActionKind, InventoryKind, InventorySlot,
    InventorySlotRole, InventorySnapshot, RecipeSnapshot,
};
use std::{
    hash::{Hash, Hasher},
    time::{Duration, Instant},
};

const LABEL: [f32; 4] = [64. / 255., 64. / 255., 64. / 255., 1.];
const MAX_SLOTS: usize = 128;
const DOUBLE_CLICK: Duration = Duration::from_millis(250);
const RECIPES_PER_PAGE: usize = 20;

#[derive(Default)]
struct RecipeBook {
    open: bool,
    search: String,
    text_focused: bool,
    craftable_only: bool,
    category: String,
    page: usize,
    cache_key: Option<u64>,
    results: Vec<(usize, bool)>,
    categories: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Transition {
    Unchanged,
    Opened,
    Closed,
}

#[derive(Clone, Copy)]
struct Pending {
    menu_id: i32,
    epoch: u64,
    opening: bool,
    since: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct StackKey(u32, u64);
impl StackKey {
    fn of(stack: &HotbarSlot) -> Option<Self> {
        (stack.count > 0).then_some(Self(stack.item_id, stack.component_fingerprint))
    }
}

#[derive(Clone, Copy)]
struct LastClick {
    menu_id: i32,
    epoch: u64,
    slot: u16,
    right: bool,
    key: Option<StackKey>,
    at: Instant,
}

struct Gesture {
    menu_id: i32,
    epoch: u64,
    right: bool,
    key: Option<StackKey>,
    count: u16,
    delivered: bool,
    collect: Option<u16>,
    slots: Vec<u16>,
}
struct DistributionPresentation {
    menu:(i32,u64), since:Instant, carried:HotbarSlot, remaining:u16,
    slots:Vec<(u16,u16,u16)>,
}
impl Gesture {
    fn valid(&self, snapshot: &InventorySnapshot) -> bool {
        snapshot.open
            && self.menu_id == snapshot.menu_id
            && self.epoch == snapshot.epoch
            && (self.delivered
                || (self.key == StackKey::of(&snapshot.cursor)
                    && self.count == snapshot.cursor.count))
    }
}

#[derive(Default)]
pub(super) struct InventoryUi {
    pending: Option<Pending>,
    sorting: Option<SortRun>,
    was_active: bool,
    close_after_open: bool,
    observed_menu: Option<(i32, u64)>,
    gesture: Option<Gesture>,
    distribution:Option<DistributionPresentation>,
    last_click: Option<LastClick>,
    book: RecipeBook,
    button_activations: u64,
}

struct SortStep { slot: u16, cursor: HotbarSlot, checks: Vec<(u16, HotbarSlot)> }
struct SortRun { menu: (i32,u64), steps: std::collections::VecDeque<SortStep>, sent: Option<(u64,Instant)> }
impl InventoryUi {
    pub fn start_sort(&mut self, snapshot: &InventorySnapshot, metrics: GuiMetrics, cursor: [f32;2]) {
        if snapshot.kind == InventoryKind::Other || snapshot.cursor.count != 0 || self.busy() || !snapshot.open { return; }
        let Some(index) = self.layout(snapshot,metrics).hovered(snapshot,cursor) else { return };
        let Some(role) = snapshot.slots.iter().find(|s|s.index==index).map(|s|s.role) else { return };
        if !matches!(role,InventorySlotRole::Player|InventorySlotRole::Storage|InventorySlotRole::Hotbar) { return; }
        let mut slots: Vec<_> = snapshot.slots.iter().filter(|s|s.role==role).take(54).map(|s|(s.index,s.stack.clone())).collect();
        let mut steps=std::collections::VecDeque::new();
        let key=|s: &HotbarSlot| (s.count==0,s.name.clone(),s.item_id,s.component_fingerprint);
        for i in 0..slots.len() {
            let j=(i..slots.len()).min_by_key(|&j|key(&slots[j].1)).unwrap();
            if key(&slots[i].1)==key(&slots[j].1) {continue;}
            let (a,b)=(slots[i].clone(),slots[j].clone());
            steps.push_back(SortStep{slot:b.0,cursor:HotbarSlot::default(),checks:vec![a.clone(),b.clone()]});
            steps.push_back(SortStep{slot:a.0,cursor:b.1.clone(),checks:vec![a.clone(),(b.0,HotbarSlot::default())]});
            if a.1.count>0 { steps.push_back(SortStep{slot:b.0,cursor:a.1.clone(),checks:vec![(a.0,b.1.clone()),(b.0,HotbarSlot::default())]}); }
            slots[i].1=b.1;slots[j].1=a.1;
        }
        self.sorting=Some(SortRun{menu:(snapshot.menu_id,snapshot.epoch),steps,sent:None});
    }
    pub fn next_sort_action(&mut self,snapshot:&InventorySnapshot)->Option<InventoryAction> {
        let run=self.sorting.as_mut()?;
        if !snapshot.open || run.menu!=(snapshot.menu_id,snapshot.epoch) {self.sorting=None;return None;}
        if let Some((revision,since))=run.sent {
            if snapshot.revision==revision {if since.elapsed()>Duration::from_secs(2){self.sorting=None;}return None;}
        }
        let Some(step)=run.steps.front() else {self.sorting=None;return None};
        let same=|a:&HotbarSlot,b:&HotbarSlot| a.count==b.count && (a.count==0 || StackKey::of(a)==StackKey::of(b));
        if !same(&step.cursor,&snapshot.cursor) || !step.checks.iter().all(|(id,stack)|snapshot.slots.iter().find(|s|s.index==*id).is_some_and(|s|same(stack,&s.stack))) {
            // Never continue against a rejected click or an external inventory change.
            self.sorting=None;return None;
        }
        let slot=run.steps.pop_front()?.slot;run.sent=Some((snapshot.revision,Instant::now()));
        Some(action(snapshot,InventoryActionKind::Pickup{slot:Some(slot),right:false}))
    }
    pub fn cancel_sort(&mut self) { self.sorting=None; }
    pub fn active(&self, snapshot: &InventorySnapshot) -> bool {
        snapshot.open || self.pending.is_some()
    }
    pub fn busy(&self) -> bool {
        self.pending.is_some() || self.distribution.is_some()
    }

    pub fn sync(
        &mut self,
        snapshot: &InventorySnapshot,
        connected: bool,
        now: Instant,
    ) -> Transition {
        if !connected {
            self.pending = None;
            self.close_after_open = false;
        } else if let Some(pending) = self.pending {
            if snapshot.menu_id != pending.menu_id
                || snapshot.epoch != pending.epoch
                || snapshot.open == pending.opening
                || now.saturating_duration_since(pending.since) > Duration::from_secs(2)
            {
                self.pending = None;
            }
        }
        let menu = (snapshot.menu_id, snapshot.epoch);
        if let Some(p)=&self.distribution {
            let matches=|s:&HotbarSlot,n:u16|s.count==n && (n==0||StackKey::of(s)==StackKey::of(&p.carried));
            let done=matches(&snapshot.cursor,p.remaining)&&p.slots.iter().all(|(id,_,n)|snapshot.slots.iter().find(|s|s.index==*id).is_some_and(|s|matches(&s.stack,*n)));
            let correction=p.slots.iter().any(|(id,before,after)|snapshot.slots.iter().find(|s|s.index==*id).is_none_or(|s|!matches(&s.stack,*before)&&!matches(&s.stack,*after)))
                || (!matches(&snapshot.cursor,p.carried.count)&&!matches(&snapshot.cursor,p.remaining));
            if !connected||!snapshot.open||p.menu!=menu||done||correction||now.saturating_duration_since(p.since)>Duration::from_secs(2) {self.distribution=None;}
        }
        if self.observed_menu != Some(menu) {
            self.book.category.clear();
            self.book.search.clear();
            self.book.page = 0;
            self.book.cache_key = None;
        }
        if !connected || !snapshot.open || self.observed_menu != Some(menu) {
            self.cancel_pointer();
            self.observed_menu = Some(menu);
        } else if self.gesture.as_ref().is_some_and(|g| !g.valid(snapshot)) {
            self.gesture = None;
        }
        let active = connected && self.active(snapshot);
        let transition = match (self.was_active, active) {
            (false, true) => Transition::Opened,
            (true, false) => Transition::Closed,
            _ => Transition::Unchanged,
        };
        self.was_active = active;
        if !active {
            self.close_after_open = false;
            self.book.text_focused = false;
        }
        if snapshot.open && self.book.open {
            self.refresh_recipes(snapshot);
        }
        transition
    }

    pub fn queued(
        &mut self,
        snapshot: &InventorySnapshot,
        kind: &InventoryActionKind,
        now: Instant,
    ) {
        let opening = match kind {
            InventoryActionKind::OpenPlayer => true,
            InventoryActionKind::Close => false,
            _ => return,
        };
        self.cancel_pointer();
        self.pending = Some(Pending {
            menu_id: snapshot.menu_id,
            epoch: snapshot.epoch,
            opening,
            since: now,
        });
        if !opening {
            self.close_after_open = false;
        }
    }
    pub fn request_close(&mut self, snapshot: &InventorySnapshot) -> Option<InventoryAction> {
        self.cancel_pointer();
        if self.pending.is_some_and(|p| p.opening) {
            self.close_after_open = true;
            None
        } else if snapshot.open && !self.busy() {
            Some(action(snapshot, InventoryActionKind::Close))
        } else {
            None
        }
    }
    pub fn deferred_close(&self, snapshot: &InventorySnapshot) -> Option<InventoryAction> {
        (self.close_after_open && snapshot.open && !self.busy())
            .then(|| action(snapshot, InventoryActionKind::Close))
    }

    /// Called on focus loss, screen replacement, or closure. Incomplete drags do
    /// not emit a partial quick-craft or drop the cursor stack.
    pub fn cancel_pointer(&mut self) {
        self.gesture = None;
        self.distribution = None;
        self.last_click = None;
        self.book.text_focused = false;
    }

    pub fn text_focused(&self) -> bool {
        self.book.open && self.book.text_focused
    }
    /// RecipeBookComponent consumes Escape on narrow screens before the
    /// container closes. The caller still handles the inventory key normally.
    pub fn dismiss_overlay(&mut self, metrics: GuiMetrics) -> bool {
        if self.book.open && metrics.width < 379. {
            self.book.open = false;
            self.cancel_pointer();
            true
        } else {
            false
        }
    }
    pub fn button_activations(&self) -> u64 {
        self.button_activations
    }
    pub fn input_text(&mut self, value: &str) -> bool {
        if !self.text_focused() {
            return false;
        }
        let remaining = 50usize.saturating_sub(self.book.search.chars().count());
        self.book
            .search
            .extend(value.chars().filter(|c| !c.is_control()).take(remaining));
        self.book.page = 0;
        self.book.cache_key = None;
        true
    }
    pub fn backspace(&mut self) -> bool {
        if !self.text_focused() {
            return false;
        }
        self.book.search.pop();
        self.book.page = 0;
        self.book.cache_key = None;
        true
    }
    pub fn clear_search(&mut self) -> bool {
        if !self.text_focused() {
            return false;
        }
        self.book.search.clear();
        self.book.page = 0;
        self.book.cache_key = None;
        true
    }
    pub fn layout(&self, snapshot: &InventorySnapshot, metrics: GuiMetrics) -> Layout {
        let mut layout = Layout::new(snapshot, metrics);
        if self.book.open && supports_recipes(snapshot) && metrics.width >= 379. {
            let x = 177. + ((metrics.width as i32 - snapshot.width as i32 - 200) / 2) as f32;
            layout.panel[0] = x;
            layout.body[0] = x;
        }
        layout
    }
    pub fn panel_visible(&self, snapshot: &InventorySnapshot, metrics: GuiMetrics) -> bool {
        !(self.book.open && supports_recipes(snapshot) && metrics.width < 379.)
    }
    pub fn key_action(
        &self,
        snapshot: &InventorySnapshot,
        metrics: GuiMetrics,
        cursor: [f32; 2],
        hotbar: Option<u8>,
        drop: bool,
        whole_stack: bool,
    ) -> Option<InventoryAction> {
        if snapshot.kind==InventoryKind::Other || self.text_focused() || !self.panel_visible(snapshot, metrics) {
            return None;
        }
        key_at(
            snapshot,
            self.layout(snapshot, metrics),
            cursor,
            hotbar,
            drop,
            whole_stack,
        )
    }

    fn refresh_recipes(&mut self, snapshot: &InventorySnapshot) {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        (
            snapshot.menu_id,
            snapshot.epoch,
            snapshot.screen.as_str(),
            std::sync::Arc::as_ptr(&snapshot.recipes) as usize,
            self.book.search.as_str(),
            self.book.category.as_str(),
            self.book.craftable_only,
        )
            .hash(&mut hasher);
        // Furnace progress alone must not repeatedly reclassify thousands of
        // recipes. Recipe data and usable inventory stacks own this cache key.
        for slot in snapshot
            .slots
            .iter()
            .take(MAX_SLOTS)
            .filter(|s| recipe_source(s.role))
        {
            (
                slot.index,
                slot.stack.item_id,
                slot.stack.count,
                slot.stack.component_fingerprint,
            )
                .hash(&mut hasher);
        }
        let cache_key = hasher.finish();
        if self.book.cache_key == Some(cache_key) {
            return;
        }
        self.book.cache_key = Some(cache_key);
        self.book.results.clear();
        self.book.categories.clear();
        let available = available_ingredients(snapshot);
        let query = search_key(&self.book.search);
        for (index, recipe) in snapshot.recipes.iter().take(4096).enumerate() {
            if !recipe_fits(snapshot, recipe) {
                continue;
            }
            if !recipe.category.is_empty() && !self.book.categories.contains(&recipe.category) {
                self.book.categories.push(recipe.category.clone());
            }
            if !self.book.category.is_empty() && self.book.category != recipe.category {
                continue;
            }
            let name = recipe
                .result
                .custom_name
                .as_ref()
                .map_or(recipe.result.name.as_str(), |n| n.plain.as_str());
            if !query.is_empty() && !search_key(name).contains(&query) {
                continue;
            }
            let craftable = can_craft(recipe, &available);
            if !self.book.craftable_only || craftable {
                self.book.results.push((index, craftable));
            }
        }
        self.book
            .categories
            .sort_by_key(|category| category_order(category));
        self.book.categories.truncate(5);
        self.book.page = self
            .book
            .page
            .min(self.book.results.len().saturating_sub(1) / RECIPES_PER_PAGE);
    }

    fn recipe_click(
        &mut self,
        snapshot: &InventorySnapshot,
        metrics: GuiMetrics,
        cursor: [f32; 2],
        right: bool,
        shift: bool,
    ) -> Option<Vec<InventoryAction>> {
        if !supports_recipes(snapshot) {
            return None;
        }
        let layout = self.layout(snapshot, metrics);
        if hit(cursor, recipe_toggle(snapshot, &layout)) && self.panel_visible(snapshot, metrics) {
            if !right {
                self.book.open = !self.book.open;
                self.book.text_focused = false;
                self.button_activations = self.button_activations.wrapping_add(1);
            }
            self.refresh_recipes(snapshot);
            return Some(Vec::new());
        }
        if !self.book.open {
            return None;
        }
        self.refresh_recipes(snapshot);
        let book = BookLayout::new(metrics);
        self.book.text_focused = hit(cursor, book.search());
        if self.book.text_focused {
            return Some(Vec::new());
        }
        if hit(cursor, book.filter()) {
            if !right {
                self.book.craftable_only = !self.book.craftable_only;
                self.book.page = 0;
                self.book.cache_key = None;
                self.button_activations = self.button_activations.wrapping_add(1);
            }
            self.refresh_recipes(snapshot);
            return Some(Vec::new());
        }
        for index in 0..=self.book.categories.len() {
            if hit(cursor, book.tab(index)) {
                if !right {
                    self.book.category = if index == 0 {
                        String::new()
                    } else {
                        self.book.categories[index - 1].clone()
                    };
                    self.book.page = 0;
                    self.book.cache_key = None;
                    self.button_activations = self.button_activations.wrapping_add(1);
                }
                self.refresh_recipes(snapshot);
                return Some(Vec::new());
            }
        }
        let pages = self.book.results.len().div_ceil(RECIPES_PER_PAGE);
        if pages > 1 && hit(cursor, book.backward()) {
            if !right && self.book.page > 0 {
                self.book.page -= 1;
                self.button_activations = self.button_activations.wrapping_add(1);
            }
            return Some(Vec::new());
        }
        if pages > 1 && hit(cursor, book.forward()) {
            if !right && self.book.page + 1 < pages {
                self.book.page += 1;
                self.button_activations = self.button_activations.wrapping_add(1);
            }
            return Some(Vec::new());
        }
        for index in 0..RECIPES_PER_PAGE {
            if hit(cursor, book.recipe(index)) {
                if let Some((recipe_index, _)) = self
                    .book
                    .results
                    .get(self.book.page * RECIPES_PER_PAGE + index)
                {
                    if !right {
                        let recipe = &snapshot.recipes[*recipe_index];
                        let result = action(
                            snapshot,
                            InventoryActionKind::PlaceRecipe {
                                recipe_id: recipe.id,
                                craft_all: shift,
                            },
                        );
                        self.button_activations = self.button_activations.wrapping_add(1);
                        if metrics.width < 379. {
                            self.book.open = false;
                        }
                        return Some(vec![result]);
                    }
                }
                return Some(Vec::new());
            }
        }
        if hit(cursor, book.panel) {
            return Some(Vec::new());
        }
        if metrics.width < 379. {
            self.book.open = false;
            return Some(Vec::new());
        }
        None
    }

    pub fn pointer_down(
        &mut self,
        snapshot: &InventorySnapshot,
        metrics: GuiMetrics,
        cursor: [f32; 2],
        right: bool,
        shift: bool,
        now: Instant,
    ) -> Vec<InventoryAction> {
        self.gesture = None;
        if !snapshot.open || self.busy() || snapshot.kind==InventoryKind::Other {
            return Vec::new();
        }
        if let Some(actions) = self.recipe_click(snapshot, metrics, cursor, right, shift) {
            return actions;
        }
        let layout = self.layout(snapshot, metrics);
        let hovered = layout.hovered(snapshot, cursor);
        let carried = StackKey::of(&snapshot.cursor);
        let source = hovered.and_then(|id| snapshot.slots.iter().find(|s| s.index == id));
        let key = carried.or_else(|| source.and_then(|s| StackKey::of(&s.stack)));
        let collect = hovered.filter(|id| {
            !right
                && !shift
                && carried.is_some()
                && self.last_click.is_some_and(|last| {
                    last.menu_id == snapshot.menu_id
                        && last.epoch == snapshot.epoch
                        && last.slot == *id
                        && !last.right
                        && last.key == carried
                        && now.saturating_duration_since(last.at) <= DOUBLE_CLICK
                })
        });
        self.last_click = hovered.map(|slot| LastClick {
            menu_id: snapshot.menu_id,
            epoch: snapshot.epoch,
            slot,
            right,
            key,
            at: now,
        });
        let mut gesture = Gesture {
            menu_id: snapshot.menu_id,
            epoch: snapshot.epoch,
            right,
            key: carried,
            count: snapshot.cursor.count,
            delivered: false,
            collect,
            slots: Vec::new(),
        };
        // Java picks up on press with an empty cursor; carrying a stack instead
        // waits for release, allowing drag distribution with the same buttons.
        let operation = if carried.is_none() {
            gesture.delivered = true;
            hovered.map(|slot| {
                if shift {
                    InventoryActionKind::QuickMove { slot }
                } else {
                    InventoryActionKind::Pickup {
                        slot: Some(slot),
                        right,
                    }
                }
            })
        } else {
            None
        };
        self.gesture = Some(gesture);
        operation
            .into_iter()
            .map(|kind| action(snapshot, kind))
            .collect()
    }

    pub fn pointer_move(
        &mut self,
        snapshot: &InventorySnapshot,
        metrics: GuiMetrics,
        cursor: [f32; 2],
    ) -> Vec<InventoryAction> {
        let layout = self.layout(snapshot, metrics);
        let Some(gesture) = self.gesture.as_mut() else {
            return Vec::new();
        };
        if !gesture.valid(snapshot) {
            self.gesture = None;
            return Vec::new();
        }
        if gesture.delivered
            || gesture.collect.is_some()
            || gesture.key.is_none()
            || gesture.slots.len() >= MAX_SLOTS
            || gesture.slots.len() >= snapshot.cursor.count as usize
        {
            return Vec::new();
        }
        let hovered = layout.hovered(snapshot, cursor);
        if let Some(slot) = hovered.and_then(|id| snapshot.slots.iter().find(|s| s.index == id)) {
            if eligible(slot, &snapshot.cursor) && !gesture.slots.contains(&slot.index) {
                gesture.slots.push(slot.index);
            }
        }
        Vec::new()
    }

    pub fn pointer_up(
        &mut self,
        snapshot: &InventorySnapshot,
        metrics: GuiMetrics,
        cursor: [f32; 2],
        right: bool,
    ) -> Vec<InventoryAction> {
        let presentation=self.drag(snapshot).filter(|g|g.right==right).map(|_|DistributionPresentation{
            menu:(snapshot.menu_id,snapshot.epoch),since:Instant::now(),carried:snapshot.cursor.clone(),remaining:self.remaining_count(snapshot),
            slots:snapshot.slots.iter().filter_map(|s|self.preview_count(snapshot,s).map(|n|(s.index,s.stack.count,n))).collect(),
        });
        let Some(gesture) = self.gesture.take() else {
            return Vec::new();
        };
        if !gesture.valid(snapshot) || gesture.right != right || gesture.delivered || self.busy() {
            return Vec::new();
        }
        let layout = self.layout(snapshot, metrics);
        let hovered = layout.hovered(snapshot, cursor);
        let kind = if let Some(slot) = gesture.collect.filter(|id| hovered == Some(*id)) {
            self.last_click = None;
            Some(InventoryActionKind::PickupAll { slot })
        } else if !gesture.slots.is_empty() {
            self.distribution=presentation;
            // One queue entry owns the complete transaction. The network adapter
            // revalidates every slot before sending native start/add/end clicks.
            Some(InventoryActionKind::Distribute {
                slots: gesture.slots,
                right,
            })
        } else if hovered.is_some()
            || (!hit(cursor, layout.panel)
                && snapshot.cursor.count > 0
                && !(self.book.open
                    && supports_recipes(snapshot)
                    && BookLayout::new(metrics).contains(cursor, self.book.categories.len())))
        {
            Some(InventoryActionKind::Pickup {
                slot: hovered,
                right,
            })
        } else {
            None
        };
        kind.into_iter()
            .map(|kind| action(snapshot, kind))
            .collect()
    }

    fn drag(&self, snapshot: &InventorySnapshot) -> Option<&Gesture> {
        self.gesture
            .as_ref()
            .filter(|g| g.valid(snapshot) && !g.delivered && !g.slots.is_empty())
    }
    fn preview_count(&self, snapshot: &InventorySnapshot, slot: &InventorySlot) -> Option<u16> {
        if let Some(p)=self.distribution.as_ref().filter(|p|p.menu==(snapshot.menu_id,snapshot.epoch)) {return p.slots.iter().find(|(id,_,_)|*id==slot.index).map(|(_,_,n)|*n);}
        let drag = self.drag(snapshot)?;
        if !drag.slots.contains(&slot.index) || !eligible(slot, &snapshot.cursor) {
            return None;
        }
        let portion = if drag.right {
            1
        } else {
            snapshot.cursor.count / drag.slots.len() as u16
        };
        Some(
            slot.stack
                .count
                .saturating_add(portion)
                .min(capacity(slot, &snapshot.cursor)),
        )
    }
    fn remaining_count(&self, snapshot: &InventorySnapshot) -> u16 {
        if let Some(p)=&self.distribution {return p.remaining;}
        let Some(drag) = self.drag(snapshot) else {
            return snapshot.cursor.count;
        };
        let placed = snapshot
            .slots
            .iter()
            .take(MAX_SLOTS)
            .filter(|s| drag.slots.contains(&s.index))
            .filter_map(|s| {
                self.preview_count(snapshot, s)
                    .map(|n| n.saturating_sub(s.stack.count))
            })
            .sum::<u16>();
        snapshot.cursor.count.saturating_sub(placed)
    }
    fn presented_cursor<'a>(&'a self,snapshot:&'a InventorySnapshot)->&'a HotbarSlot {self.distribution.as_ref().map_or(&snapshot.cursor,|p|&p.carried)}
}

fn capacity(slot: &InventorySlot, cursor: &HotbarSlot) -> u16 {
    slot.max_count.max(1).min(cursor.max_count.max(1))
}
fn eligible(slot: &InventorySlot, cursor: &HotbarSlot) -> bool {
    cursor.count > 0
        && slot.may_place_cursor
        && slot.role != InventorySlotRole::Result
        && (slot.stack.count == 0 || StackKey::of(&slot.stack) == StackKey::of(cursor))
        && slot.stack.count < capacity(slot, cursor)
}

fn supports_recipes(snapshot: &InventorySnapshot) -> bool {
    matches!(
        snapshot.kind,
        InventoryKind::Player | InventoryKind::Crafting | InventoryKind::Furnace
    )
}
fn recipe_fits(snapshot: &InventorySnapshot, recipe: &RecipeSnapshot) -> bool {
    match snapshot.kind {
        InventoryKind::Player => !recipe.furnace && recipe.width <= 2 && recipe.height <= 2,
        InventoryKind::Crafting => !recipe.furnace && recipe.width <= 3 && recipe.height <= 3,
        InventoryKind::Furnace => recipe.furnace && recipe.station == snapshot.screen,
        _ => false,
    }
}
fn search_key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .take(256)
        .collect()
}
fn category_order(category: &str) -> u8 {
    if category.contains("building") || category.contains("food") {
        0
    } else if category.contains("equipment") || category.contains("blocks") {
        1
    } else if category.contains("redstone") {
        2
    } else {
        3
    }
}
fn recipe_source(role: InventorySlotRole) -> bool {
    matches!(
        role,
        InventorySlotRole::Player
            | InventorySlotRole::Hotbar
            | InventorySlotRole::CraftingInput
            | InventorySlotRole::Ingredient
    )
}
fn available_ingredients(snapshot: &InventorySnapshot) -> Vec<(u32, u16)> {
    let mut available: Vec<(u32, u16)> = Vec::with_capacity(40);
    for slot in snapshot
        .slots
        .iter()
        .take(MAX_SLOTS)
        .filter(|s| recipe_source(s.role) && s.stack.count > 0)
    {
        if let Some((_, count)) = available
            .iter_mut()
            .find(|(id, _)| *id == slot.stack.item_id)
        {
            *count = count.saturating_add(slot.stack.count);
        } else {
            available.push((slot.stack.item_id, slot.stack.count));
        }
    }
    available
}

/// Small capacity-aware matching, not a greedy item subtraction. A recipe such
/// as [oak OR birch, oak] remains craftable with one oak and one birch. This only
/// decides the book's presentation; the server always performs placement/craft.
fn can_craft(recipe: &RecipeSnapshot, available: &[(u32, u16)]) -> bool {
    if !recipe.ingredients_resolved {
        return false;
    }
    let ingredients: Vec<_> = recipe
        .ingredients
        .iter()
        .filter(|i| !i.is_empty())
        .take(9)
        .collect();
    if ingredients.is_empty() {
        return false;
    }
    let options: Vec<Vec<usize>> = ingredients
        .iter()
        .map(|ids| {
            available
                .iter()
                .enumerate()
                .filter(|(_, (id, count))| *count > 0 && ids.contains(id))
                .map(|(i, _)| i)
                .collect()
        })
        .collect();
    fn assign(
        ingredient: usize,
        options: &[Vec<usize>],
        available: &[(u32, u16)],
        assigned: &mut [Option<usize>; 9],
        seen: &mut [bool; 9],
    ) -> bool {
        if seen[ingredient] {
            return false;
        }
        seen[ingredient] = true;
        for &item in &options[ingredient] {
            let used = assigned.iter().filter(|v| **v == Some(item)).count();
            if used < available[item].1 as usize {
                assigned[ingredient] = Some(item);
                return true;
            }
            for other in 0..options.len() {
                if assigned[other] == Some(item)
                    && assign(other, options, available, assigned, seen)
                {
                    assigned[ingredient] = Some(item);
                    return true;
                }
            }
        }
        false
    }
    let mut assigned = [None; 9];
    (0..options.len()).all(|ingredient| {
        assign(
            ingredient,
            &options,
            available,
            &mut assigned,
            &mut [false; 9],
        )
    })
}

#[derive(Clone, Copy)]
struct BookLayout {
    panel: [f32; 4],
}
impl BookLayout {
    fn new(metrics: GuiMetrics) -> Self {
        Self {
            panel: [
                ((metrics.width as i32 - 147) / 2) as f32
                    - if metrics.width >= 379. { 86. } else { 0. },
                ((metrics.height as i32 - 166) / 2) as f32,
                147.,
                166.,
            ],
        }
    }
    fn rect(&self, x: f32, y: f32, w: f32, h: f32) -> [f32; 4] {
        [self.panel[0] + x, self.panel[1] + y, w, h]
    }
    fn search(&self) -> [f32; 4] {
        self.rect(25., 13., 81., 14.)
    }
    fn filter(&self) -> [f32; 4] {
        self.rect(110., 12., 26., 16.)
    }
    fn forward(&self) -> [f32; 4] {
        self.rect(93., 137., 12., 17.)
    }
    fn backward(&self) -> [f32; 4] {
        self.rect(38., 137., 12., 17.)
    }
    fn tab(&self, index: usize) -> [f32; 4] {
        self.rect(-30., 3. + index as f32 * 27., 35., 27.)
    }
    fn recipe(&self, index: usize) -> [f32; 4] {
        self.rect(
            11. + (index % 5) as f32 * 25.,
            31. + (index / 5) as f32 * 25.,
            25.,
            25.,
        )
    }
    fn contains(&self, cursor: [f32; 2], categories: usize) -> bool {
        hit(cursor, self.panel) || (0..=categories).any(|i| hit(cursor, self.tab(i)))
    }
}
fn recipe_toggle(snapshot: &InventorySnapshot, layout: &Layout) -> [f32; 4] {
    let (x, y) = match snapshot.kind {
        InventoryKind::Player => (104., 61.),
        InventoryKind::Crafting => (5., 34.),
        InventoryKind::Furnace => (20., 34.),
        _ => (-1000., -1000.),
    };
    [layout.body[0] + x, layout.body[1] + y, 20., 18.]
}

pub(super) fn action(snapshot: &InventorySnapshot, kind: InventoryActionKind) -> InventoryAction {
    InventoryAction {
        menu_id: snapshot.menu_id,
        epoch: snapshot.epoch,
        kind,
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Layout {
    pub panel: [f32; 4],
    pub body: [f32; 2],
}
impl Layout {
    pub fn new(snapshot: &InventorySnapshot, metrics: GuiMetrics) -> Self {
        let w = snapshot.width.clamp(176, 256) as f32;
        let h = snapshot.height.clamp(96, 256) as f32;
        // Java integer division deliberately leaves the extra pixel on the
        // right/bottom. Both drawing and hit tests consume these logical pixels.
        let x = ((metrics.width as i32 - w as i32) / 2) as f32;
        let y = ((metrics.height as i32 - h as i32) / 2) as f32;
        Self {
            panel: [x, y, w, h],
            body: [x, y],
        }
    }
    pub fn slot(&self, slot: &InventorySlot) -> [f32; 4] {
        [
            self.body[0] + slot.x as f32,
            self.body[1] + slot.y as f32,
            16.,
            16.,
        ]
    }
    pub fn point(&self, x: f32, y: f32) -> [f32; 2] {
        [self.body[0] + x, self.body[1] + y]
    }
    pub fn hovered(&self, snapshot: &InventorySnapshot, cursor: [f32; 2]) -> Option<u16> {
        snapshot
            .slots
            .iter()
            .take(MAX_SLOTS)
            .find(|slot| {
                let [x, y, _, _] = self.slot(slot);
                hit(cursor, [x - 1., y - 1., 18., 18.])
            })
            .map(|slot| slot.index)
    }
    /// The Java player preview occupies this exact logical rectangle. Its 3D
    /// draw is integrated by the renderer, separately from flat container art.
    pub fn player_preview(&self) -> [f32; 4] {
        [self.body[0] + 26., self.body[1] + 8., 49., 70.]
    }
}
fn hit(point: [f32; 2], rect: [f32; 4]) -> bool {
    point[0] >= rect[0]
        && point[0] < rect[0] + rect[2]
        && point[1] >= rect[1]
        && point[1] < rect[1] + rect[3]
}

#[cfg(test)]
fn key_action(
    snapshot: &InventorySnapshot,
    metrics: GuiMetrics,
    cursor: [f32; 2],
    hotbar: Option<u8>,
    drop: bool,
    whole_stack: bool,
) -> Option<InventoryAction> {
    key_at(
        snapshot,
        Layout::new(snapshot, metrics),
        cursor,
        hotbar,
        drop,
        whole_stack,
    )
}
fn key_at(
    snapshot: &InventorySnapshot,
    layout: Layout,
    cursor: [f32; 2],
    hotbar: Option<u8>,
    drop: bool,
    whole_stack: bool,
) -> Option<InventoryAction> {
    if !snapshot.open {
        return None;
    }
    let slot = layout.hovered(snapshot, cursor)?;
    let kind = if let Some(hotbar) = hotbar.filter(|slot| *slot < 9 || *slot == 40) {
        InventoryActionKind::SwapHotbar { slot, hotbar }
    } else if drop && snapshot.cursor.count == 0 {
        InventoryActionKind::Drop { slot, whole_stack }
    } else {
        return None;
    };
    Some(action(snapshot, kind))
}

pub(super) fn hash(
    state: &InventoryUi,
    snapshot: &InventorySnapshot,
    cursor: [f32; 2],
    metrics: GuiMetrics,
    hasher: &mut impl Hasher,
) {
    state.active(snapshot).hash(hasher);
    if !state.active(snapshot) {
        return;
    }
    (
        snapshot.open,
        snapshot.menu_id,
        snapshot.epoch,
        snapshot.revision,
        state.busy(),
    )
        .hash(hasher);
    (
        metrics.scale.to_bits(),
        metrics.width.to_bits(),
        metrics.height.to_bits(),
    )
        .hash(hasher);
    if snapshot.open {
        (
            state.book.open,
            state.book.search.as_str(),
            state.book.text_focused,
            state.book.craftable_only,
            state.book.category.as_str(),
            state.book.page,
            state.book.cache_key,
        )
            .hash(hasher);
        let hovered = state.layout(snapshot, metrics).hovered(snapshot, cursor);
        hovered.hash(hasher);
        // Tooltip and carried item follow the same integer mouse coordinates as
        // Java, so their cached geometry must track movement even within a slot.
        if snapshot.cursor.count > 0
            || hovered
                .and_then(|id| snapshot.slots.iter().find(|s| s.index == id))
                .is_some_and(|s| s.stack.count > 0)
        {
            (cursor[0] as i32, cursor[1] as i32).hash(hasher);
        }
        if let Some(drag) = state.drag(snapshot) {
            drag.right.hash(hasher);
            drag.slots.hash(hasher);
        }
        if let Some(p)=&state.distribution {p.menu.hash(hasher);p.slots.hash(hasher);p.remaining.hash(hasher);(cursor[0] as i32,cursor[1] as i32).hash(hasher);}
        if state.book.open || supports_recipes(snapshot) {
            (cursor[0] as i32, cursor[1] as i32).hash(hasher);
        }
    }
}

pub(super) fn draw(
    painter: &mut Painter<'_>,
    state: &InventoryUi,
    snapshot: &InventorySnapshot,
    cursor: [f32; 2],
) {
    if !snapshot.open {
        return;
    }
    if snapshot.kind==InventoryKind::Other {
        painter.solid([0.,0.,painter.metrics.width,painter.metrics.height],[0.,0.,0.,0.6]);
        let center=painter.metrics.width/2.;let y=painter.metrics.height/2.;
        painter.centered_text(&snapshot.title,center,y-20.,[1.;4],true);
        painter.centered_text("This workstation is not supported by Sakura yet.",center,y,[1.;4],true);
        painter.centered_text("Press Escape to return to the game.",center,y+14.,[0.65,0.65,0.65,1.],true);
        return;
    }
    let layout = state.layout(snapshot, painter.metrics);
    let [x, y, w, h] = layout.panel;
    painter.solid(
        [0., 0., painter.metrics.width, painter.metrics.height],
        [0., 0., 0., 0.6],
    );
    if state.book.open && supports_recipes(snapshot) {
        draw_recipe_book(painter, state, snapshot, cursor);
        if !state.panel_visible(snapshot, painter.metrics) {
            draw_recipe_tooltip(painter, state, snapshot, cursor);
            if snapshot.cursor.count > 0 {
                painter.item(
                    &snapshot.cursor,
                    cursor[0].floor() - 8.,
                    cursor[1].floor() - 8.,
                    true,
                );
            }
            return;
        }
    }
    draw_background(painter, snapshot, &layout);
    if snapshot.kind == InventoryKind::Player {
        painter.sprite("sakura/internal/player_preview", layout.player_preview());
    }
    draw_progress(painter, snapshot, &layout);
    let title = if snapshot.kind == InventoryKind::Player {
        painter.translated("container.crafting")
    } else {
        snapshot.title.clone()
    };
    let title_x = match snapshot.kind {
        InventoryKind::Player => 97.,
        InventoryKind::Crafting => 29.,
        InventoryKind::Furnace | InventoryKind::Brewing | InventoryKind::Dispenser => {
            ((w - painter.text_width(&title)) / 2.).floor()
        }
        _ => 8.,
    };
    painter.text(&title, x + title_x, y + 6., LABEL, false);
    if snapshot.kind != InventoryKind::Player {
        let inventory = painter.translated("container.inventory");
        painter.text(&inventory, x + 8., y + h - 94., LABEL, false);
    }
    if supports_recipes(snapshot) {
        let toggle = recipe_toggle(snapshot, &layout);
        painter.sprite(
            if hit(cursor, toggle) {
                "gui/sprites/recipe_book/button_highlighted"
            } else {
                "gui/sprites/recipe_book/button"
            },
            toggle,
        );
    }
    let hovered = layout.hovered(snapshot, cursor);
    if let Some(slot) = hovered.and_then(|id| snapshot.slots.iter().find(|s| s.index == id)) {
        let [sx, sy, _, _] = layout.slot(slot);
        painter.sprite(
            "gui/sprites/container/slot_highlight_back",
            [sx - 4., sy - 4., 24., 24.],
        );
    }
    for slot in snapshot.slots.iter().take(MAX_SLOTS) {
        let [sx, sy, _, _] = layout.slot(slot);
        if let Some(count) = state.preview_count(snapshot, slot) {
            painter.item_count(state.presented_cursor(snapshot), count, sx, sy, true);
        } else if slot.stack.count > 0 {
            painter.item(&slot.stack, sx, sy, true);
        } else if snapshot.kind == InventoryKind::Player {
            let icon = match (slot.role, slot.index) {
                (InventorySlotRole::Armor, 5) => Some("helmet"),
                (InventorySlotRole::Armor, 6) => Some("chestplate"),
                (InventorySlotRole::Armor, 7) => Some("leggings"),
                (InventorySlotRole::Armor, 8) => Some("boots"),
                (InventorySlotRole::Offhand, _) => Some("shield"),
                _ => None,
            };
            if let Some(icon) = icon {
                painter.sprite(
                    &format!("gui/sprites/container/slot/{icon}"),
                    [sx, sy, 16., 16.],
                );
            }
        }
    }
    if let Some(slot) = hovered.and_then(|id| snapshot.slots.iter().find(|s| s.index == id)) {
        let [sx, sy, _, _] = layout.slot(slot);
        painter.sprite(
            "gui/sprites/container/slot_highlight_front",
            [sx - 4., sy - 4., 24., 24.],
        );
        if snapshot.cursor.count == 0 && slot.stack.count > 0 {
            painter.tooltip(&slot.stack, cursor);
        }
    }
    let remaining = state.remaining_count(snapshot);
    draw_recipe_tooltip(painter, state, snapshot, cursor);
    if remaining > 0 {
        painter.item_count(
            state.presented_cursor(snapshot),
            remaining,
            cursor[0] as i32 as f32 - 8.,
            cursor[1] as i32 as f32 - 8.,
            true,
        );
    }
}

fn draw_recipe_book(
    painter: &mut Painter<'_>,
    state: &InventoryUi,
    snapshot: &InventorySnapshot,
    cursor: [f32; 2],
) {
    let book = BookLayout::new(painter.metrics);
    painter.sprite_crop("gui/recipe_book", book.panel, [1., 1., 147., 166.]);
    let search = book.search();
    painter.sprite(
        if state.text_focused() {
            "gui/sprites/widget/text_field_highlighted"
        } else {
            "gui/sprites/widget/text_field"
        },
        search,
    );
    painter.sprite("gui/sprites/icon/search", book.rect(8., 15., 12., 12.));
    let shown = if state.book.search.is_empty() && !state.text_focused() {
        painter.label("gui.recipebook.search_hint")
    } else {
        state.book.search.clone()
    };
    // Java's edit box scrolls its text within the field; keep glyphs clipped by
    // selecting a fitting trailing run instead of letting long input spill out.
    let mut visible = shown.as_str();
    while painter.text_width(visible) > search[2] - 8. {
        let Some((next, _)) = visible.char_indices().nth(1) else {
            break;
        };
        visible = &visible[next..];
    }
    painter.text(
        visible,
        search[0] + 4.,
        search[1] + 3.,
        if state.book.search.is_empty() && !state.text_focused() {
            [0.5, 0.5, 0.5, 1.]
        } else {
            [1.; 4]
        },
        true,
    );
    if state.text_focused() && (painter.time * 2.) as u64 % 2 == 0 {
        painter.solid(
            [
                search[0] + 4. + painter.text_width(visible),
                search[1] + 2.,
                1.,
                9.,
            ],
            [1.; 4],
        );
    }
    let furnace = if snapshot.kind == InventoryKind::Furnace {
        "furnace_"
    } else {
        ""
    };
    let enabled = if state.book.craftable_only {
        "enabled"
    } else {
        "disabled"
    };
    let hover = if hit(cursor, book.filter()) {
        "_highlighted"
    } else {
        ""
    };
    painter.sprite(
        &format!("gui/sprites/recipe_book/{furnace}filter_{enabled}{hover}"),
        book.filter(),
    );
    for index in 0..=state.book.categories.len() {
        let category = if index == 0 {
            ""
        } else {
            state.book.categories[index - 1].as_str()
        };
        let selected = state.book.category == category;
        let mut rect = book.tab(index);
        if selected {
            rect[0] -= 2.;
        }
        painter.sprite(
            if selected {
                "gui/sprites/recipe_book/tab_selected"
            } else {
                "gui/sprites/recipe_book/tab"
            },
            rect,
        );
        let icon = category_icon(category);
        painter.item(
            &HotbarSlot {
                item_id: icon,
                count: 1,
                ..Default::default()
            },
            rect[0] + 9.,
            rect[1] + 5.,
            false,
        );
    }
    for (visible, &(index, craftable)) in state
        .book
        .results
        .iter()
        .skip(state.book.page * RECIPES_PER_PAGE)
        .take(RECIPES_PER_PAGE)
        .enumerate()
    {
        let Some(recipe) = snapshot.recipes.get(index) else {
            continue;
        };
        let rect = book.recipe(visible);
        painter.sprite(
            if craftable {
                "gui/sprites/recipe_book/slot_craftable"
            } else {
                "gui/sprites/recipe_book/slot_uncraftable"
            },
            rect,
        );
        painter.item(&recipe.result, rect[0] + 4., rect[1] + 4., false);
    }
    let pages = state.book.results.len().div_ceil(RECIPES_PER_PAGE);
    if pages > 1 {
        let label = painter
            .label("gui.recipebook.page")
            .replacen("%s", &(state.book.page + 1).to_string(), 1)
            .replacen("%s", &pages.to_string(), 1);
        painter.centered_text(
            &label,
            book.panel[0] + 73.,
            book.panel[1] + 141.,
            [1.; 4],
            true,
        );
        if state.book.page > 0 {
            painter.sprite(
                if hit(cursor, book.backward()) {
                    "gui/sprites/recipe_book/page_backward_highlighted"
                } else {
                    "gui/sprites/recipe_book/page_backward"
                },
                book.backward(),
            );
        }
        if state.book.page + 1 < pages {
            painter.sprite(
                if hit(cursor, book.forward()) {
                    "gui/sprites/recipe_book/page_forward_highlighted"
                } else {
                    "gui/sprites/recipe_book/page_forward"
                },
                book.forward(),
            );
        }
    }
}
fn draw_recipe_tooltip(
    painter: &mut Painter<'_>,
    state: &InventoryUi,
    snapshot: &InventorySnapshot,
    cursor: [f32; 2],
) {
    if !state.book.open || !supports_recipes(snapshot) || snapshot.cursor.count > 0 {
        return;
    }
    let book = BookLayout::new(painter.metrics);
    for (visible, &(index, _)) in state
        .book
        .results
        .iter()
        .skip(state.book.page * RECIPES_PER_PAGE)
        .take(RECIPES_PER_PAGE)
        .enumerate()
    {
        if hit(cursor, book.recipe(visible)) {
            if let Some(recipe) = snapshot.recipes.get(index) {
                painter.tooltip(&recipe.result, cursor);
            }
            break;
        }
    }
}
fn category_icon(category: &str) -> u32 {
    use azalea_registry::builtin::ItemKind as Item;
    (if category.is_empty() {
        Item::Compass
    } else if category.contains("building") {
        Item::Bricks
    } else if category.contains("equipment") {
        Item::IronAxe
    } else if category.contains("redstone") {
        Item::Redstone
    } else if category.contains("food") {
        Item::Porkchop
    } else if category.contains("blocks") {
        Item::Stone
    } else {
        Item::LavaBucket
    }) as u32
}

fn draw_background(painter: &mut Painter<'_>, snapshot: &InventorySnapshot, layout: &Layout) {
    let [x, y, w, h] = layout.panel;
    if let InventoryKind::Chest { rows } = snapshot.kind {
        if snapshot.screen == "generic_54" {
            let top = rows.clamp(1, 6) as f32 * 18. + 17.;
            painter.sprite_crop(
                "gui/container/generic_54",
                [x, y, 176., top],
                [0., 0., 176., top],
            );
            painter.sprite_crop(
                "gui/container/generic_54",
                [x, y + top, 176., 96.],
                [0., 126., 176., 96.],
            );
            return;
        }
    }
    // The backend supplies an allowlisted resource key matching the actual menu;
    // unknown/custom menus never borrow a misleading chest texture.
    let sprite = format!("gui/container/{}", snapshot.screen);
    painter.sprite_crop(&sprite, [x, y, w, h], [0., 0., w, h]);
}

fn property(snapshot: &InventorySnapshot, id: u16) -> i32 {
    snapshot
        .properties
        .iter()
        .find(|(key, _)| *key == id)
        .map_or(0, |(_, value)| i32::from(*value))
}
fn furnace_progress(snapshot: &InventorySnapshot) -> (u16, u16) {
    let lit = property(snapshot, 0);
    let duration = property(snapshot, 1).max(1);
    let flame = if lit > 0 {
        ((lit as f32 / duration as f32).clamp(0., 1.) * 13.).ceil() as u16 + 1
    } else {
        0
    };
    let cook = ((property(snapshot, 2).max(0) as f32 / property(snapshot, 3).max(1) as f32)
        .clamp(0., 1.)
        * 24.)
        .ceil() as u16;
    (flame, cook)
}
fn draw_progress(painter: &mut Painter<'_>, snapshot: &InventorySnapshot, layout: &Layout) {
    let [x, y] = layout.body;
    if snapshot.kind == InventoryKind::Furnace {
        let (flame, cook) = furnace_progress(snapshot);
        let flame = flame as f32;
        let cook = cook as f32;
        if flame > 0. {
            painter.sprite_crop(
                &format!("gui/sprites/container/{}/lit_progress", snapshot.screen),
                [x + 56., y + 50. - flame, 14., flame],
                [0., 14. - flame, 14., flame],
            );
        }
        if cook > 0. {
            painter.sprite_crop(
                &format!("gui/sprites/container/{}/burn_progress", snapshot.screen),
                [x + 79., y + 34., cook, 16.],
                [0., 0., cook, 16.],
            );
        }
    } else if snapshot.kind == InventoryKind::Brewing {
        let fuel = ((18 * property(snapshot, 1).max(0) + 19) / 20).clamp(0, 18) as f32;
        if fuel > 0. {
            painter.sprite_crop(
                "gui/sprites/container/brewing_stand/fuel_length",
                [x + 60., y + 44., fuel, 4.],
                [0., 0., fuel, 4.],
            );
        }
        let ticks = property(snapshot, 0).clamp(0, 400);
        if ticks > 0 {
            let progress = (28. * (1. - ticks as f32 / 400.)) as u16 as f32;
            if progress > 0. {
                painter.sprite_crop(
                    "gui/sprites/container/brewing_stand/brew_progress",
                    [x + 97., y + 16., 9., progress],
                    [0., 0., 9., progress],
                );
            }
            let bubble = [29., 24., 20., 16., 11., 6., 0.][(ticks as usize / 2) % 7];
            if bubble > 0. {
                painter.sprite_crop(
                    "gui/sprites/container/brewing_stand/bubbles",
                    [x + 63., y + 43. - bubble, 12., bubble],
                    [0., 29. - bubble, 12., bubble],
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use winit::dpi::PhysicalSize;
    #[test]
    fn released_distribution_survives_partial_packets_until_all_slots_and_cursor_match() {
        for right in [false,true] {
            let mut s=inventory();s.cursor=stack(12);
            let mut ui=InventoryUi::default();let now=Instant::now();ui.sync(&s,true,now);
            ui.pointer_down(&s,metrics(),pointer(&s,0),right,false,now);
            ui.pointer_move(&s,metrics(),pointer(&s,0));
            ui.pointer_move(&s,metrics(),pointer(&s,1));
            let count=if right {1}else{6};let remaining=12-count*2;
            assert_eq!(ui.pointer_up(&s,metrics(),pointer(&s,1),right).len(),1);
            for delay in [0,50,200,500] {
                ui.sync(&s,true,now+Duration::from_millis(delay));
                assert_eq!(ui.preview_count(&s,&s.slots[0]),Some(count));
                assert_eq!(ui.remaining_count(&s),remaining);
            }
            s.cursor=if remaining==0 {Default::default()}else{stack(remaining)};
            s.slots[0].stack=stack(count);ui.sync(&s,true,now+Duration::from_millis(550));
            assert_eq!(ui.preview_count(&s,&s.slots[1]),Some(count));
            assert_eq!(ui.presented_cursor(&s).item_id,15);
            assert!(ui.busy());
            s.slots[1].stack=stack(count);ui.sync(&s,true,now+Duration::from_millis(600));
            assert!(!ui.busy());assert_eq!(ui.preview_count(&s,&s.slots[1]),None);
        }
    }
    #[test]
    fn released_distribution_accepts_corrections_and_never_outlives_its_menu() {
        for reason in 0..5 {
            let mut s=inventory();s.cursor=stack(12);let now=Instant::now();
            let mut ui=InventoryUi::default();ui.sync(&s,true,now);
            ui.pointer_down(&s,metrics(),pointer(&s,0),true,false,now);
            ui.pointer_move(&s,metrics(),pointer(&s,0));
            ui.pointer_move(&s,metrics(),pointer(&s,1));
            ui.pointer_up(&s,metrics(),pointer(&s,1),true);
            match reason {0=>s.epoch+=1,1=>s.slots[0].stack=stack(5),2=>s.cursor.component_fingerprint+=1,3=>s.open=false,_=>{}}
            ui.sync(&s,true,now+Duration::from_secs(if reason==4 {3}else{0}));
            assert!(ui.distribution.is_none(),"reason {reason}");
        }
    }
    fn metrics() -> GuiMetrics {
        GuiMetrics::new(PhysicalSize::new(1100, 720), 3)
    }
    fn stack(count: u16) -> HotbarSlot {
        HotbarSlot {
            item_id: 15,
            count,
            name: "Stone".into(),
            max_count: 64,
            component_fingerprint: 81,
            ..Default::default()
        }
    }
    fn inventory() -> InventorySnapshot {
        InventorySnapshot {
            open: true,
            epoch: 17,
            menu_id: 4,
            slots: vec![22, 41, 61]
                .into_iter()
                .enumerate()
                .map(|(i, index)| InventorySlot {
                    index,
                    x: 8 + i as u16 * 18,
                    y: 18,
                    role: InventorySlotRole::Storage,
                    stack: HotbarSlot::default(),
                    may_place_cursor: true,
                    max_count: 64,
                })
                .collect(),
            ..Default::default()
        }
    }
    fn pointer(snapshot: &InventorySnapshot, index: usize) -> [f32; 2] {
        let [x, y, _, _] = Layout::new(snapshot, metrics()).slot(&snapshot.slots[index]);
        [x + 2., y + 2.]
    }
    #[test]
    fn sorting_waits_for_ack_and_aborts_changed_cursor() {
        let mut snap=inventory();
        snap.cursor=HotbarSlot::default();
        for (i,slot) in snap.slots.iter_mut().enumerate(){slot.role=InventorySlotRole::Player;slot.stack=stack(1);slot.stack.item_id=(10-i) as u32;slot.stack.name=format!("{}",10-i);}
        let mut ui=InventoryUi::default();
        ui.start_sort(&snap,metrics(),pointer(&snap,0));
        assert!(ui.next_sort_action(&snap).is_some());
        assert!(ui.next_sort_action(&snap).is_none(),"must wait for server");
        snap.revision+=1;snap.cursor=stack(55);
        assert!(ui.next_sort_action(&snap).is_none(),"unexpected server state cancels sort");
        assert!(ui.sorting.is_none());
    }
    #[test]
    fn offhand_shortcut_uses_protocol_button_40() {
        let snap=inventory();
        assert!(matches!(key_action(&snap,metrics(),pointer(&snap,0),Some(40),false,false).unwrap().kind,InventoryActionKind::SwapHotbar{hotbar:40,..}));
    }
    #[test]
    fn reference_panel_and_hitboxes_match_integer_gui_scales() {
        let snapshot = inventory();
        for size in [
            PhysicalSize::new(1100, 720),
            PhysicalSize::new(420, 320),
            PhysicalSize::new(1920, 1080),
        ] {
            for requested in [0, 1, 2, 3, 4] {
                let metrics = GuiMetrics::new(size, requested);
                let layout = Layout::new(&snapshot, metrics);
                assert_eq!(layout.panel[2..], [176., 166.]);
                assert_eq!(layout.panel[0].fract(), 0.);
                assert_eq!(layout.panel[1].fract(), 0.);
                let [x, y, _, _] = layout.slot(&snapshot.slots[0]);
                assert_eq!(
                    layout.hovered(
                        &snapshot,
                        metrics.pointer([(x + 0.5) * metrics.scale, (y + 0.5) * metrics.scale])
                    ),
                    Some(22)
                );
                assert_eq!(layout.hovered(&snapshot, [x - 1., y]), Some(22));
                assert_eq!(layout.hovered(&snapshot, [x + 16.9, y]), Some(22));
                assert_eq!(layout.hovered(&snapshot, [x + 17., y]), Some(41));
                assert_eq!(layout.hovered(&snapshot, [x - 1.1, y]), None);
            }
        }
    }
    #[test]
    fn panel_background_never_means_drop_outside() {
        let mut snapshot = inventory();
        snapshot.cursor = stack(5);
        let mut ui = InventoryUi::default();
        let cursor = Layout::new(&snapshot, metrics()).point(88., 65.);
        assert!(
            ui.pointer_down(&snapshot, metrics(), cursor, false, false, Instant::now())
                .is_empty()
        );
        assert!(
            ui.pointer_up(&snapshot, metrics(), cursor, false)
                .is_empty()
        );
        ui.pointer_down(&snapshot, metrics(), [1., 1.], true, false, Instant::now());
        let actions = ui.pointer_up(&snapshot, metrics(), [1., 1.], true);
        assert!(matches!(
            actions[0].kind,
            InventoryActionKind::Pickup {
                slot: None,
                right: true
            }
        ));
        assert_eq!((actions[0].menu_id, actions[0].epoch), (4, 17));
    }
    #[test]
    fn press_picks_up_once_and_keyboard_maps_to_real_operations() {
        let snapshot = inventory();
        let cursor = pointer(&snapshot, 0);
        let mut ui = InventoryUi::default();
        let actions = ui.pointer_down(&snapshot, metrics(), cursor, true, false, Instant::now());
        assert!(matches!(
            actions[0].kind,
            InventoryActionKind::Pickup {
                slot: Some(22),
                right: true
            }
        ));
        assert!(ui.pointer_up(&snapshot, metrics(), cursor, true).is_empty());
        let actions = ui.pointer_down(&snapshot, metrics(), cursor, false, true, Instant::now());
        assert!(matches!(
            actions[0].kind,
            InventoryActionKind::QuickMove { slot: 22 }
        ));
        assert!(matches!(
            key_action(&snapshot, metrics(), cursor, Some(8), false, false)
                .unwrap()
                .kind,
            InventoryActionKind::SwapHotbar {
                slot: 22,
                hotbar: 8
            }
        ));
        assert!(matches!(
            key_action(&snapshot, metrics(), cursor, None, true, true)
                .unwrap()
                .kind,
            InventoryActionKind::Drop {
                slot: 22,
                whole_stack: true
            }
        ));
    }
    #[test]
    fn drag_is_one_atomic_deduplicated_gesture_with_component_and_capacity_checks() {
        let mut snapshot = inventory();
        snapshot.cursor = stack(12);
        snapshot.slots[1].stack = stack(62);
        snapshot.slots[2].stack = stack(1);
        snapshot.slots[2].stack.component_fingerprint = 99;
        let before = snapshot.clone();
        let mut ui = InventoryUi::default();
        ui.pointer_down(
            &snapshot,
            metrics(),
            pointer(&snapshot, 0),
            false,
            false,
            Instant::now(),
        );
        for index in [0, 0, 1, 2] {
            assert!(
                ui.pointer_move(&snapshot, metrics(), pointer(&snapshot, index))
                    .is_empty()
            );
        }
        assert_eq!(ui.preview_count(&snapshot, &snapshot.slots[0]), Some(6));
        assert_eq!(ui.preview_count(&snapshot, &snapshot.slots[1]), Some(64));
        assert_eq!(ui.preview_count(&snapshot, &snapshot.slots[2]), None);
        assert_eq!(ui.remaining_count(&snapshot), 4);
        let actions = ui.pointer_up(&snapshot, metrics(), pointer(&snapshot, 1), false);
        assert!(
            matches!(&actions[0].kind, InventoryActionKind::Distribute { slots, right: false } if slots == &[22, 41])
        );
        assert_eq!(
            snapshot, before,
            "preview and dispatch may not mutate authoritative quantities"
        );
        assert!(
            ui.pointer_up(&snapshot, metrics(), pointer(&snapshot, 1), false)
                .is_empty()
        );
    }
    #[test]
    fn right_drag_respects_slot_restrictions_and_available_quantity() {
        let mut snapshot = inventory();
        snapshot.cursor = stack(2);
        snapshot.slots[1].may_place_cursor = false;
        snapshot.slots[2].role = InventorySlotRole::Armor;
        snapshot.slots[2].max_count = 1;
        let mut ui = InventoryUi::default();
        ui.pointer_down(
            &snapshot,
            metrics(),
            pointer(&snapshot, 0),
            true,
            false,
            Instant::now(),
        );
        for i in [0, 1, 2] {
            ui.pointer_move(&snapshot, metrics(), pointer(&snapshot, i));
        }
        assert_eq!(ui.remaining_count(&snapshot), 0);
        assert_eq!(ui.preview_count(&snapshot, &snapshot.slots[2]), Some(1));
        let actions = ui.pointer_up(&snapshot, metrics(), pointer(&snapshot, 2), true);
        assert!(
            matches!(&actions[0].kind, InventoryActionKind::Distribute { slots, right: true } if slots == &[22, 61])
        );
    }
    #[test]
    fn collect_requires_same_slot_components_button_epoch_and_time_window() {
        let now = Instant::now();
        for (elapsed, changed_component, changed_epoch, right, expected) in [
            (100, false, false, false, true),
            (251, false, false, false, false),
            (100, true, false, false, false),
            (100, false, true, false, false),
            (100, false, false, true, false),
        ] {
            let mut snapshot = inventory();
            snapshot.slots[0].stack = stack(5);
            let mut ui = InventoryUi::default();
            ui.pointer_down(
                &snapshot,
                metrics(),
                pointer(&snapshot, 0),
                false,
                false,
                now,
            );
            ui.pointer_up(&snapshot, metrics(), pointer(&snapshot, 0), false);
            snapshot.cursor = stack(5);
            snapshot.slots[0].stack = HotbarSlot::default();
            if changed_component {
                snapshot.cursor.component_fingerprint += 1;
            }
            if changed_epoch {
                snapshot.epoch += 1;
            }
            ui.pointer_down(
                &snapshot,
                metrics(),
                pointer(&snapshot, 0),
                right,
                false,
                now + Duration::from_millis(elapsed),
            );
            let actions = ui.pointer_up(&snapshot, metrics(), pointer(&snapshot, 0), right);
            assert_eq!(
                matches!(actions[0].kind, InventoryActionKind::PickupAll { slot: 22 }),
                expected
            );
        }
    }
    #[test]
    fn focus_loss_menu_replacement_and_cursor_correction_cancel_drag_without_drop() {
        for reason in 0..3 {
            let mut snapshot = inventory();
            snapshot.cursor = stack(12);
            let mut ui = InventoryUi::default();
            ui.pointer_down(
                &snapshot,
                metrics(),
                pointer(&snapshot, 0),
                false,
                false,
                Instant::now(),
            );
            ui.pointer_move(&snapshot, metrics(), pointer(&snapshot, 1));
            match reason {
                0 => ui.cancel_pointer(),
                1 => snapshot.epoch += 1,
                _ => snapshot.cursor.count = 11,
            }
            assert!(
                ui.pointer_up(&snapshot, metrics(), [1., 1.], false)
                    .is_empty()
            );
        }
    }
    #[test]
    fn rapid_open_then_close_waits_for_server_acknowledged_epoch() {
        let now = Instant::now();
        let mut snapshot = InventorySnapshot::default();
        let mut ui = InventoryUi::default();
        ui.queued(&snapshot, &InventoryActionKind::OpenPlayer, now);
        assert_eq!(ui.sync(&snapshot, true, now), Transition::Opened);
        assert!(ui.request_close(&snapshot).is_none());
        snapshot.open = true;
        snapshot.epoch = 1;
        ui.sync(&snapshot, true, now);
        let close = ui.deferred_close(&snapshot).unwrap();
        assert_eq!(close.epoch, 1);
        ui.queued(&snapshot, &close.kind, now);
        snapshot.open = false;
        snapshot.epoch = 2;
        assert_eq!(ui.sync(&snapshot, true, now), Transition::Closed);
    }
    #[test]
    fn server_replacing_a_closing_menu_preserves_new_screen() {
        let now = Instant::now();
        let mut snapshot = inventory();
        let mut ui = InventoryUi::default();
        ui.sync(&snapshot, true, now);
        ui.queued(&snapshot, &InventoryActionKind::Close, now);
        snapshot.menu_id = 7;
        snapshot.epoch += 1;
        assert_eq!(ui.sync(&snapshot, true, now), Transition::Unchanged);
        assert!(ui.active(&snapshot));
        assert!(!ui.busy());
    }
    #[test]
    fn furnace_progress_uses_reference_rounding_and_stays_inside_sprites() {
        let mut snapshot = inventory();
        snapshot.properties = vec![(0, 1), (1, 100), (2, 1), (3, 200)];
        assert_eq!(furnace_progress(&snapshot), (2, 1));
        snapshot.properties = vec![(0, 200), (1, 100), (2, 400), (3, 200)];
        assert_eq!(furnace_progress(&snapshot), (14, 24));
        snapshot.properties = vec![(0, -2), (1, 0), (2, -1), (3, 0)];
        assert_eq!(furnace_progress(&snapshot), (0, 0));
    }
    fn recipe(id: u32) -> RecipeSnapshot {
        RecipeSnapshot {
            id,
            result: stack(1),
            width: 1,
            height: 1,
            ingredients: vec![vec![15]],
            furnace: false,
            shapeless: false,
            station: "crafting_table".into(),
            category: "crafting_building_blocks".into(),
            group: 0,
            ingredients_resolved: true,
        }
    }
    #[test]
    fn recipe_craftability_resolves_alternatives_without_inventing_tag_predicates() {
        let mut r = recipe(1);
        r.ingredients = vec![vec![15, 20], vec![15]];
        assert!(can_craft(&r, &[(15, 1), (20, 1)]));
        assert!(!can_craft(&r, &[(15, 1)]));
        assert!(can_craft(&r, &[(15, 2)]));
        r.ingredients_resolved = false;
        assert!(!can_craft(&r, &[(15, 64), (20, 64)]));
    }
    #[test]
    fn recipe_selection_emits_actual_server_id_and_only_one_button_sound() {
        let mut snapshot = inventory();
        snapshot.recipes = std::sync::Arc::new(vec![recipe(991)]);
        let mut ui = InventoryUi::default();
        let m = metrics();
        let toggle = recipe_toggle(&snapshot, &ui.layout(&snapshot, m));
        ui.pointer_down(
            &snapshot,
            m,
            [toggle[0] + 2., toggle[1] + 2.],
            false,
            false,
            Instant::now(),
        );
        assert_eq!(ui.button_activations(), 1);
        assert!(ui.book.open);
        let rect = BookLayout::new(m).recipe(0);
        let cursor = [rect[0] + 2., rect[1] + 2.];
        let actions = ui.pointer_down(&snapshot, m, cursor, false, true, Instant::now());
        assert!(matches!(
            actions[0].kind,
            InventoryActionKind::PlaceRecipe {
                recipe_id: 991,
                craft_all: true
            }
        ));
        assert!(ui.pointer_up(&snapshot, m, cursor, false).is_empty());
        assert_eq!(ui.button_activations(), 2);
    }
    #[test]
    fn recipe_search_filters_server_results_and_does_not_consume_world_shortcuts() {
        let mut snapshot = inventory();
        let mut a = recipe(1);
        a.result.name = "OakPlanks".into();
        let mut b = recipe(2);
        b.result.name = "IronSword".into();
        snapshot.recipes = std::sync::Arc::new(vec![a, b]);
        let mut ui = InventoryUi::default();
        ui.book.open = true;
        ui.book.text_focused = true;
        assert!(ui.input_text("oak planks"));
        ui.refresh_recipes(&snapshot);
        assert_eq!(
            ui.book.results.iter().map(|(i, _)| *i).collect::<Vec<_>>(),
            [0]
        );
        assert!(
            ui.key_action(
                &snapshot,
                metrics(),
                pointer(&snapshot, 0),
                Some(1),
                true,
                false
            )
            .is_none()
        );
        assert!(ui.clear_search());
        ui.refresh_recipes(&snapshot);
        assert_eq!(ui.book.results.len(), 2);
        ui.book.text_focused = false;
        assert!(!ui.input_text("ignored"));
    }
    #[test]
    fn recipe_book_uses_wide_shift_and_narrow_overlay_without_outside_drop() {
        let mut snapshot = inventory();
        snapshot.cursor = stack(5);
        let mut ui = InventoryUi::default();
        ui.book.open = true;
        let wide = GuiMetrics::new(PhysicalSize::new(1600, 900), 2);
        assert_eq!(ui.layout(&snapshot, wide).panel[0], 389.);
        assert!(ui.panel_visible(&snapshot, wide));
        let first = ui.layout(&snapshot, wide).slot(&snapshot.slots[0]);
        ui.pointer_down(
            &snapshot,
            wide,
            [first[0], first[1]],
            false,
            false,
            Instant::now(),
        );
        let book = BookLayout::new(wide);
        assert!(
            ui.pointer_up(
                &snapshot,
                wide,
                [book.panel[0] + 5., book.panel[1] + 100.],
                false
            )
            .is_empty()
        );
        let narrow = GuiMetrics::new(PhysicalSize::new(640, 480), 2);
        assert!(!ui.panel_visible(&snapshot, narrow));
        assert!(
            ui.pointer_down(&snapshot, narrow, [1., 1.], false, false, Instant::now())
                .is_empty()
        );
        assert!(ui.panel_visible(&snapshot, narrow));
        ui.book.open = true;
        assert!(ui.dismiss_overlay(narrow));
        assert!(
            snapshot.open,
            "Escape dismisses the overlay without a container-close operation"
        );
        ui.book.open = true;
        assert!(!ui.dismiss_overlay(wide));
    }
    #[test]
    fn recipe_cache_ignores_workstation_progress_and_updates_changed_stacks() {
        let mut snapshot = inventory();
        snapshot.recipes = std::sync::Arc::new(vec![recipe(1)]);
        snapshot.slots[0].role = InventorySlotRole::Player;
        let mut ui = InventoryUi::default();
        ui.refresh_recipes(&snapshot);
        let first = ui.book.cache_key;
        assert!(!ui.book.results[0].1);
        snapshot.revision += 1;
        snapshot.properties = vec![(2, 75)];
        ui.refresh_recipes(&snapshot);
        assert_eq!(ui.book.cache_key, first);
        snapshot.slots[0].stack = stack(1);
        ui.refresh_recipes(&snapshot);
        assert_ne!(ui.book.cache_key, first);
        assert!(ui.book.results[0].1);
    }
}
