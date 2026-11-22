import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

type Topic = "Minecraft" | "Delight";
type Story = {
  title: string; description: string; label: string; topic: Topic; image: string; url: string;
};

// Editorial picks from the official Minecraft Launcher news feed. Bundled covers also render offline.
const stories: Story[] = [
  { title: "Catch me outside", description: "Nine community maps to explore on Java Realms.", label: "Java Realms", topic: "Minecraft", image: "launcher-stories/outside.jpg", url: "https://www.minecraft.net/article/new-on-java-realms--catch-me-outside" },
  { title: "Meet Deep Freeze", description: "Take a look inside Minecraft’s upcoming ice caves.", label: "Game updates", topic: "Minecraft", image: "launcher-stories/deep-freeze.png", url: "https://www.minecraft.net/article/twitchcon-gamedrop-name" },
  { title: "Grinding & Galaxy", description: "Explore nine maps from the Java Realms community.", label: "Map spotlight", topic: "Minecraft", image: "launcher-stories/galaxy.jpg", url: "https://www.minecraft.net/article/new-on-java-realms--grinding-and-galaxy" },
  { title: "Meet the mapmakers", description: "The creators behind the Realms Mapmaker Awards.", label: "Community", topic: "Minecraft", image: "launcher-stories/mapmakers.jpg", url: "https://www.minecraft.net/article/java-realms-mapmaker-awards" },
  { title: "Delight Client release notes", description: "Read the changes in the latest published launcher release.", label: "Delight Client", topic: "Delight", image: "delight-logo.png", url: "https://github.com/Parksdotjar/BloomClient-V2/releases/latest" },
];
const topics: Topic[] = ["Minecraft", "Delight"];

export function HomeStories() {
  const [topic, setTopic] = useState<Topic>("Minecraft");
  const [error, setError] = useState("");
  const picks = stories.filter(story => story.topic === topic);
  const read = async (story: Story) => {
    setError("");
    try { await openUrl(story.url); } catch { setError("The article could not be opened in your browser."); }
  };
  return <section className="home-news" aria-label="News">
    <header><h2>News</h2><nav aria-label="News topics">{topics.map(item =>
      <button key={item} aria-pressed={topic === item} onClick={() => { setTopic(item); setError(""); }}>{item}</button>)}</nav></header>
    <div className="home-news-grid">{picks.map(story =>
      <button key={story.url} onClick={() => void read(story)}>
        <img className={story.topic === "Delight" ? "brand-cover" : ""} src={new URL(story.image, document.baseURI).href} alt=""/>
        <strong>{story.title}</strong><span>{story.description}</span>
      </button>)}</div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
