use dioxus::prelude::*;
use crate::drag_drop::{DragGhost, DragState, ResizeState, TileRect, TileRefs};
use crate::layout::MosaicLayout;
use crate::node::Node;
use crate::split_pane::SplitPane;
use crate::tile_pane::TilePane;
use crate::types::{NodeId, TileId};

#[derive(PartialEq, Clone, Props)]
pub struct MosaicProps {
    pub layout: Signal<MosaicLayout>,
    pub render_tile: Signal<Box<dyn Fn(TileId) -> Option<Element>>>,
    pub render_title: Signal<Box<dyn Fn(TileId) -> Element>>,
    #[props(default = None)]
    pub render_empty_state: Option<Signal<Box<dyn Fn() -> Element>>>,
}

pub fn Mosaic(props: MosaicProps) -> Element {
    let mut layout = props.layout;
    let mut drag_state = use_signal(DragState::new);
    let tile_refs = use_signal(TileRefs::new);
    let resize_state = use_signal(ResizeState::default);

    use_context_provider(|| layout);
    use_context_provider(|| drag_state);
    use_context_provider(|| tile_refs);
    use_context_provider(|| resize_state);
    use_context_provider(|| props.render_tile);
    use_context_provider(|| props.render_title);

    let root_id = layout.read().root().cloned();

    let handle_mouse_move = move |evt: Event<MouseData>| {
        if !drag_state.read().is_dragging() {
            return;
        }

        let mouse_x = evt.page_coordinates().x as f64;
        let mouse_y = evt.page_coordinates().y as f64;

        // If we don't have cached rects yet, fetch them asynchronously (once)
        if drag_state.read().cached_rects.is_empty() && !drag_state.read().rects_fetching {
            drag_state.write().rects_fetching = true;

            let dragging_tile_id = drag_state.read().dragging_tile_id.clone();
            let refs_snapshot: Vec<_> = tile_refs
                .read()
                .refs
                .iter()
                .filter(|(tid, _)| Some(*tid) != dragging_tile_id.as_ref())
                .map(|(tid, mounted)| (tid.clone(), mounted.clone()))
                .collect();

            spawn(async move {
                let mut rects = std::collections::HashMap::new();
                for (tid, mounted) in refs_snapshot {
                    if let Ok(rect) = mounted.get_client_rect().await {
                        rects.insert(tid, TileRect {
                            x: rect.origin.x,
                            y: rect.origin.y,
                            width: rect.size.width,
                            height: rect.size.height,
                        });
                    }
                }
                let mut state = drag_state.write();
                state.cached_rects = rects;
                state.rects_fetching = false;
                state.update_hover_from_cache();
            });

            drag_state.write().update_position(mouse_x, mouse_y);
            return;
        }

        let mut state = drag_state.write();
        state.update_position(mouse_x, mouse_y);
        state.update_hover_from_cache();
    };

    let handle_mouse_up = move |_evt: Event<MouseData>| {
        if !drag_state.read().is_dragging() {
            return;
        }

        let dragged_tile = match drag_state.read().dragging_tile_id.clone() {
            Some(tid) => tid,
            None => return,
        };

        if let Some((target_tile, zone)) = drag_state.read().hover_target.clone() {
            if dragged_tile != target_tile {
                layout.write().insert_tile_with_split(&dragged_tile, &target_tile, zone);
            }
        }

        drag_state.write().end_drag();
    };

    rsx! {
        div {
            class: "mosaic-container",
            style: {
                let block_selection = drag_state.read().is_dragging() || resize_state.read().is_resizing;
                let user_select = if block_selection { "user-select: none; -webkit-user-select: none;" } else { "" };
                format!("width: 100%; height: 100%; position: relative; {user_select}")
            },
            onmousemove: handle_mouse_move,
            onmouseup: handle_mouse_up,

            if let Some(root) = root_id {
                MosaicNode {
                    key: "{root}",
                    node_id: root,
                }
            } else {
                if let Some(render_empty) = props.render_empty_state {
                    {(render_empty.read())()}
                } else {
                    div {
                        style: "
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100%;
                            color: #888;
                            font-size: 1rem;
                        ",
                        "No panels open"
                    }
                }
            }

            if drag_state.read().is_dragging() {
                DragGhost {
                    drag_state: drag_state,
                    render_title: props.render_title,
                }
            }
        }
    }
}

#[component]
fn MosaicNode(node_id: NodeId) -> Element {
    let mut layout = use_context::<Signal<MosaicLayout>>();
    let render_tile = use_context::<Signal<Box<dyn Fn(TileId) -> Option<Element>>>>();
    let render_title = use_context::<Signal<Box<dyn Fn(TileId) -> Element>>>();
    let node = layout.read().get_node(&node_id).cloned();

    match node {
        Some(Node::Tile {
            tile_id,
            locked,
            ..
        }) => {
            let tile_id_for_horizontal = tile_id.clone();
            let tile_id_for_vertical = tile_id.clone();
            let tile_id_for_close = tile_id.clone();

            let title = (render_title.read())(tile_id.clone());
            let content = (render_tile.read())(tile_id.clone());

            rsx! {
                TilePane {
                    key: "{node_id}",
                    tile_id: tile_id.clone(),
                    title_component: title,
                    locked: locked,
                    on_split_horizontal: move |_| {
                        let new_tile_id = format!("{}_new", tile_id_for_horizontal);
                        layout.write().split_tile(
                            &tile_id_for_horizontal,
                            crate::types::SplitDirection::Horizontal,
                            new_tile_id,
                            50.0
                        );
                    },
                    on_split_vertical: move |_| {
                        let new_tile_id = format!("{}_new", tile_id_for_vertical);
                        layout.write().split_tile(
                            &tile_id_for_vertical,
                            crate::types::SplitDirection::Vertical,
                            new_tile_id,
                            50.0
                        );
                    },
                    on_close: move |_| {
                        layout.write().close_tile(&tile_id_for_close);
                    },

                    {content}
                }
            }
        }

        Some(Node::Split {
            direction,
            first,
            second,
            split_percentage,
            ..
        }) => {
            let node_id_for_resize = node_id.clone();

            let split_key = format!("{node_id}:{direction:?}");

            rsx! {
                SplitPane {
                    key: "{split_key}",
                    direction: direction,
                    initial_size: split_percentage,
                    min_size: 20.0,
                    max_size: 80.0,
                    on_resize: Some(EventHandler::new(move |new_pos: f64| {
                        layout.write().update_split(&node_id_for_resize, new_pos);
                    })),

                    first_pane: rsx! {
                        MosaicNode {
                            key: "{first}",
                            node_id: first.clone(),
                        }
                    },

                    second_pane: rsx! {
                        MosaicNode {
                            key: "{second}",
                            node_id: second.clone(),
                        }
                    },
                }
            }
        }

        None => {
            rsx! {
                div {
                    style: "color: red; padding: 1rem;",
                    "Error: Node not found"
                }
            }
        }
    }
}
