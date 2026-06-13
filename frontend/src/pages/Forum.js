import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import RevealSection from "../components/RevealSection";
import ReportButton from "../components/ReportButton";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const initialPostForm = {
  authorAddress: "",
  category: "general",
  title: "",
  body: "",
  imageData: "",
};

const initialReplyForm = {
  authorAddress: "",
  body: "",
  imageData: "",
};

const forumCategories = [
  { value: "all", label: "All Categories" },
  { value: "general", label: "General" },
  { value: "mining", label: "Mining" },
  { value: "lending", label: "Lending" },
  { value: "exchange", label: "Community Requests" },
  { value: "governance", label: "Governance" },
  { value: "technical", label: "Technical" },
];

function formatTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

function readImageFile(file, onLoad) {
  if (!file) {
    onLoad("");
    return;
  }

  if (!file.type.startsWith("image/")) {
    toast.error("Please choose an image file.");
    return;
  }

  if (file.size > 2_000_000) {
    toast.error("Please choose an image under 2 MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => onLoad(String(reader.result || ""));
  reader.readAsDataURL(file);
}

function Forum() {
  const [posts, setPosts] = useState([]);
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [selectedPostId, setSelectedPostId] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);
  const [postForm, setPostForm] = useState(initialPostForm);
  const [replyForm, setReplyForm] = useState(initialReplyForm);
  const [upvoteAddress, setUpvoteAddress] = useState("");
  const [featureVoterAddress, setFeatureVoterAddress] = useState("");
  const [activeTab, setActiveTab] = useState("featured");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingPost, setLoadingPost] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadPosts({ quiet = false } = {}) {
    try {
      const response = await api.get("/forum/posts");
      setPosts(response.data.posts || []);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load forum posts.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoadingPosts(false);
    }
  }

  async function loadFeaturedPosts({ quiet = false } = {}) {
    try {
      const response = await api.get("/forum/featured");
      setFeaturedPosts(response.data.posts || []);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load featured forum posts.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoadingPosts(false);
    }
  }

  async function loadPost(postId) {
    setSelectedPostId(postId);
    setLoadingPost(true);
    try {
      const response = await api.get("/forum/post", { params: { post_id: postId } });
      setSelectedPost(response.data.post);
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load this forum post.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingPost(false);
    }
  }

  useEffect(() => {
    loadPosts();
    loadFeaturedPosts({ quiet: true });
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      const query = searchQuery.trim();
      if (!query) {
        await loadPosts({ quiet: true });
        return;
      }

      try {
        const response = await api.get("/forum/search", { params: { q: query } });
        setPosts(response.data.posts || []);
        setErrorMessage("");
      } catch (error) {
        setErrorMessage(apiErrorMessage(error, "Unable to search forum posts."));
      } finally {
        setLoadingPosts(false);
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const displayedPosts = useMemo(() => {
    const sourcePosts = activeTab === "featured" ? featuredPosts : posts;
    if (categoryFilter === "all") {
      return sourcePosts;
    }

    return sourcePosts.filter((post) => (post.category || "general") === categoryFilter);
  }, [activeTab, featuredPosts, posts, categoryFilter]);

  async function createPost(event) {
    event.preventDefault();
    if (!postForm.authorAddress.trim() || !postForm.title.trim() || !postForm.body.trim()) {
      toast.error("Fill in your wallet address, title, and message.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post("/forum/post", {
        author_address: postForm.authorAddress.trim(),
        category: postForm.category,
        title: postForm.title.trim(),
        body: postForm.body.trim(),
        image_data: postForm.imageData,
      });
      toast.success("Forum post created.");
      setPostForm(initialPostForm);
      await loadPosts({ quiet: true });
      await loadFeaturedPosts({ quiet: true });
      await loadPost(response.data.post_id);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to create forum post.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function addReply(event) {
    event.preventDefault();
    if (!selectedPostId || !replyForm.authorAddress.trim() || !replyForm.body.trim()) {
      toast.error("Enter your wallet address and reply.");
      return;
    }
    if (selectedPost?.moderation_status === "locked") {
      toast.error("This post is locked by moderation.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/forum/reply", {
        post_id: selectedPostId,
        author_address: replyForm.authorAddress.trim(),
        body: replyForm.body.trim(),
        image_data: replyForm.imageData,
      });
      toast.success("Reply posted.");
      setReplyForm(initialReplyForm);
      await loadPost(selectedPostId);
      await loadPosts({ quiet: true });
      await loadFeaturedPosts({ quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to post reply.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function upvotePost() {
    if (!selectedPostId || !upvoteAddress.trim()) {
      toast.error("Enter your wallet address before upvoting.");
      return;
    }

    try {
      await api.post("/forum/upvote", {
        post_id: selectedPostId,
        address: upvoteAddress.trim(),
      });
      toast.success("Post upvoted.");
      setUpvoteAddress("");
      await loadPost(selectedPostId);
      await loadPosts({ quiet: true });
      await loadFeaturedPosts({ quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to upvote this post.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function featurePost(postId) {
    if (!postId || !featureVoterAddress.trim()) {
      toast.error("Enter your wallet address before featuring a post.");
      return;
    }

    try {
      await api.post("/forum/feature", {
        post_id: postId,
        voter_address: featureVoterAddress.trim(),
      });
      toast.success("Your feature vote was recorded.");
      setFeatureVoterAddress("");
      if (selectedPostId === postId) {
        await loadPost(postId);
      }
      await loadPosts({ quiet: true });
      await loadFeaturedPosts({ quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to record your feature vote.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Discussion</span>
        <h1>Forum</h1>
        <p className="subtitle">
          Share ideas, ask questions, post community updates, and talk with other Vorliq members.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <RevealSection className="card card-pad stack" aria-label="Forum and moderation clarity">
        <div className="section-title">
          <div>
            <span className="eyebrow">Community Layer</span>
            <h2>How the forum works</h2>
          </div>
        </div>
        <p>
          The forum is a public coordination space for Vorliq members. Posts, replies, images, wallet
          addresses, votes, feature votes, reports, and moderation labels can be visible to other users.
        </p>
        <div className="lifecycle-grid">
          <article className="lifecycle-step">
            <h3>Public read-only</h3>
            <p>Anyone can read visible posts, replies, authors, public wallet identities, and featured-post signals.</p>
          </article>
          <article className="lifecycle-step">
            <h3>Wallet context</h3>
            <p>Posting, replying, upvoting, featuring, and reporting use public wallet addresses. They do not require private keys.</p>
          </article>
          <article className="lifecycle-step">
            <h3>Moderation</h3>
            <p>Reports create a review queue. Moderator and admin actions are protected and are not shown as public controls.</p>
          </article>
        </div>
        <div className="risk-box">
          <strong>Never share secrets in community content</strong>
          <p>
            Do not post private keys, wallet passwords, backup files, seed phrases, admin tokens, raw logs,
            private documents, or sensitive personal information. VLQ movement should be reviewed and signed
            locally on the <Link className="text-button" to="/send">Send</Link> page.
          </p>
        </div>
      </RevealSection>

      <section className="two-column grid">
        <div className="card card-pad stack">
          <div className="section-title">
            <h2>Community Posts</h2>
            <button className="button secondary small-button" type="button" onClick={() => loadPosts()}>
              Refresh
            </button>
          </div>
          <div className="tab-list">
            <button
              className={`tab-button ${activeTab === "featured" ? "active" : ""}`}
              type="button"
              onClick={() => {
                setActiveTab("featured");
                loadFeaturedPosts();
              }}
            >
              Featured
            </button>
            <button
              className={`tab-button ${activeTab === "all" ? "active" : ""}`}
              type="button"
              onClick={() => {
                setActiveTab("all");
                loadPosts();
              }}
            >
              All Posts
            </button>
          </div>
          <div className="forum-controls">
            <input
              className="input"
              type="search"
              aria-label="Search forum posts"
              placeholder="Search forum posts"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <select
              className="input"
              aria-label="Filter forum posts by category"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              {forumCategories.map((category) => (
                <option value={category.value} key={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          <input
            className="input"
            type="text"
            aria-label="Wallet address for feature votes"
            placeholder="Wallet address for feature votes"
            value={featureVoterAddress}
            onChange={(event) => setFeatureVoterAddress(event.target.value)}
          />
          {loadingPosts ? (
            <Spinner label="Loading forum posts..." />
          ) : displayedPosts.length === 0 ? (
            <div className="empty-state">
              {activeTab === "featured"
                ? "No featured posts yet. Be the first to feature a great post."
                : "No forum posts yet. Start the first discussion."}
            </div>
          ) : (
            <div className="forum-list">
              {displayedPosts.map((post) => (
                <article
                  className={`forum-card ${selectedPostId === post.post_id ? "active" : ""} ${
                    post.pinned ? "pinned" : ""
                  }`}
                  key={post.post_id}
                >
                  <div
                    className="forum-open-button"
                    role="button"
                    tabIndex="0"
                    onClick={() => loadPost(post.post_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        loadPost(post.post_id);
                      }
                    }}
                  >
                    <strong>
                      {post.featured && <span className="featured-star" aria-label="Featured post">&#9733;</span>}
                      {post.title}
                    </strong>
                    <span className="badge forum-category">{post.category || "general"}</span>
                    {post.moderation_status === "locked" && <span className="badge">Locked</span>}
                    <span>By <AddressIdentity address={post.author_address} compact /></span>
                    <span>
                      {post.vote_count} votes - {post.feature_vote_count || 0} feature votes - {post.replies?.length || 0} replies
                    </span>
                    {post.image_data && <img className="forum-thumb" src={post.image_data} alt="Forum attachment" />}
                    <small>{formatTime(post.timestamp)}</small>
                  </div>
                  <button className="button secondary small-button" type="button" onClick={() => featurePost(post.post_id)}>
                    Feature this Post
                  </button>
                  <ReportButton targetType="forum_post" targetId={post.post_id} />
                </article>
              ))}
            </div>
          )}

          <div className="forum-create">
            <h2>Create a New Post</h2>
            <form className="form" onSubmit={createPost}>
              <div className="field">
                <label htmlFor="forum-author">Wallet Address</label>
                <input
                  id="forum-author"
                  className="input"
                  type="text"
                  value={postForm.authorAddress}
                  onChange={(event) =>
                    setPostForm((current) => ({ ...current, authorAddress: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="forum-title">Title</label>
                <input
                  id="forum-title"
                  className="input"
                  type="text"
                  value={postForm.title}
                  onChange={(event) =>
                    setPostForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="forum-category">Category</label>
                <select
                  id="forum-category"
                  className="input"
                  value={postForm.category}
                  onChange={(event) =>
                    setPostForm((current) => ({ ...current, category: event.target.value }))
                  }
                >
                  {forumCategories
                    .filter((category) => category.value !== "all")
                    .map((category) => (
                      <option value={category.value} key={category.value}>
                        {category.label}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="forum-body">Message</label>
                <textarea
                  id="forum-body"
                  className="textarea"
                  value={postForm.body}
                  onChange={(event) =>
                    setPostForm((current) => ({ ...current, body: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="forum-image">Image or Screenshot</label>
                <input
                  id="forum-image"
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    readImageFile(event.target.files?.[0], (imageData) =>
                      setPostForm((current) => ({ ...current, imageData }))
                    )
                  }
                />
                {postForm.imageData && <img className="forum-preview" src={postForm.imageData} alt="Selected upload preview" />}
              </div>
              <button className="button" type="submit" disabled={submitting}>
                {submitting ? "Posting..." : "Post Message"}
              </button>
            </form>
          </div>
        </div>

        <div className="card card-pad stack forum-detail">
          {loadingPost ? (
            <Spinner label="Loading full post..." />
          ) : selectedPost ? (
            <>
              <div className="section-title">
                <div>
                  <span className="eyebrow">Full Post</span>
                  <h2>
                    {selectedPost.featured && <span className="featured-star" aria-label="Featured post">&#9733;</span>}
                    {selectedPost.title}
                  </h2>
                  <span className="badge forum-category">{selectedPost.category || "general"}</span>
                </div>
              </div>
              <p>{selectedPost.body}</p>
              {selectedPost.moderation_status === "hidden" && (
                <div className="risk-box">This content is hidden by moderation. It is shown as a notice instead of the original content.</div>
              )}
              {selectedPost.moderation_status === "locked" && (
                <div className="risk-box">This post is locked by moderation and cannot receive new replies.</div>
              )}
              {selectedPost.image_data && <img className="forum-image" src={selectedPost.image_data} alt="Forum attachment" />}
              <div className="block-meta">
                <div className="meta-item">
                  <span className="meta-label">Author</span>
                  <span className="meta-value"><AddressIdentity address={selectedPost.author_address} compact /></span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Votes</span>
                  <span className="meta-value">{selectedPost.vote_count}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Feature Votes</span>
                  <span className="meta-value">{selectedPost.feature_vote_count || 0}</span>
                </div>
              </div>
              <div className="inline-form">
                <input
                  className="input"
                  type="text"
                  aria-label="Wallet address for upvote"
                  placeholder="Wallet address for upvote"
                  value={upvoteAddress}
                  onChange={(event) => setUpvoteAddress(event.target.value)}
                />
                <button className="button" type="button" onClick={upvotePost}>
                  Upvote
                </button>
              </div>
              <button className="button secondary small-button" type="button" onClick={() => featurePost(selectedPost.post_id)}>
                Feature this Post
              </button>
              <ReportButton targetType="forum_post" targetId={selectedPost.post_id} />

              <section className="stack">
                <h2>Replies</h2>
                {selectedPost.replies?.length ? (
                  selectedPost.replies.map((reply) => (
                    <article className="reply-card" key={reply.reply_id}>
                      {reply.moderation_status === "hidden" && <span className="badge">Hidden by moderation</span>}
                      <p>{reply.body}</p>
                      {reply.image_data && <img className="forum-image" src={reply.image_data} alt="Reply attachment" />}
                      <span>
                        <AddressIdentity address={reply.author_address} compact /> - {reply.vote_count} votes - {formatTime(reply.timestamp)}
                      </span>
                      <ReportButton targetType="forum_reply" targetId={reply.reply_id} />
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No replies yet.</div>
                )}
              </section>

              {selectedPost.moderation_status === "locked" ? (
                <div className="empty-state">Replies are closed because this post is locked by moderation.</div>
              ) : (
              <form className="form" onSubmit={addReply}>
                <h2>Reply</h2>
                <div className="field">
                  <label htmlFor="reply-author">Wallet Address</label>
                  <input
                    id="reply-author"
                    className="input"
                    type="text"
                    value={replyForm.authorAddress}
                    onChange={(event) =>
                      setReplyForm((current) => ({ ...current, authorAddress: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="reply-body">Reply</label>
                  <textarea
                    id="reply-body"
                    className="textarea"
                    value={replyForm.body}
                    onChange={(event) =>
                      setReplyForm((current) => ({ ...current, body: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="reply-image">Image or Screenshot</label>
                  <input
                    id="reply-image"
                    className="input"
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      readImageFile(event.target.files?.[0], (imageData) =>
                        setReplyForm((current) => ({ ...current, imageData }))
                      )
                    }
                  />
                  {replyForm.imageData && <img className="forum-preview" src={replyForm.imageData} alt="Selected reply upload preview" />}
                </div>
                <button className="button" type="submit" disabled={submitting}>
                  {submitting ? "Posting..." : "Post Reply"}
                </button>
              </form>
              )}
            </>
          ) : (
            <div className="empty-state">Select a post to read the full discussion.</div>
          )}
        </div>
      </section>
    </div>
  );
}

export default Forum;
