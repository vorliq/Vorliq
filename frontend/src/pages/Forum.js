import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import RevealSection from "../components/RevealSection";
import ReportButton from "../components/ReportButton";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { useAuth } from "../context/AuthContext";
import { authorityErrorMessage, postSignedAuthority } from "../helpers/signedAuthority";

const initialPostForm = {
  category: "general",
  title: "",
  body: "",
  imageData: "",
  password: "",
};

const initialReplyForm = {
  body: "",
  imageData: "",
  password: "",
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

const PAGE_SIZE = 10;

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
  const { wallet, isLoggedIn } = useAuth();
  const address = wallet?.address;
  const [posts, setPosts] = useState([]);
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [selectedPostId, setSelectedPostId] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);
  const [postForm, setPostForm] = useState(initialPostForm);
  const [replyForm, setReplyForm] = useState(initialReplyForm);
  const [upvoteAddress, setUpvoteAddress] = useState("");
  const [featurePassword, setFeaturePassword] = useState("");
  const [activeTab, setActiveTab] = useState("featured");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingPost, setLoadingPost] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [offset, setOffset] = useState(0);
  const [totalPosts, setTotalPosts] = useState(0);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  // A ref keeps loadPosts free of reactive dependencies so the load effects stay stable.
  const offsetRef = useRef(0);

  async function loadPosts({ quiet = false, offset: nextOffset = offsetRef.current } = {}) {
    try {
      const response = await api.get("/forum/posts", { params: { limit: PAGE_SIZE, offset: nextOffset } });
      setPosts(response.data.posts || []);
      setTotalPosts(Number.isFinite(response.data.total) ? response.data.total : (response.data.posts || []).length);
      setHasMorePosts(Boolean(response.data.has_more));
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
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

  const searchInitialisedRef = useRef(false);

  useEffect(() => {
    loadPosts({ offset: 0 });
    loadFeaturedPosts({ quiet: true });
  }, []);

  // Prefill the upvote address with the connected wallet so a signed-in member
  // doesn't have to retype it (consistent with how posting/replying use the
  // connected wallet). Doesn't clobber a value the user is already editing.
  useEffect(() => {
    if (address) setUpvoteAddress((current) => current || address);
  }, [address]);

  useEffect(() => {
    // Skip the first run: the mount effect already performs the initial load, so
    // the search debounce must not fire on mount and reset pagination.
    if (!searchInitialisedRef.current) {
      searchInitialisedRef.current = true;
      return undefined;
    }
    const timeout = window.setTimeout(async () => {
      const query = searchQuery.trim();
      if (!query) {
        await loadPosts({ quiet: true, offset: 0 });
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
    if (!isLoggedIn || !address) {
      toast.error("Sign in to your wallet to post.");
      return;
    }
    if (!postForm.title.trim() || !postForm.body.trim()) {
      toast.error("Fill in a title and message.");
      return;
    }
    if (!postForm.password) {
      toast.error("Enter your wallet password to sign this post locally.");
      return;
    }

    setSubmitting(true);
    try {
      // Authorship is signed locally so the author address cannot be spoofed;
      // the server binds the post to the wallet that proved control of it.
      const response = await postSignedAuthority({
        action: "forum.post",
        walletPassword: postForm.password,
        body: {
          category: postForm.category,
          title: postForm.title.trim(),
          body: postForm.body.trim(),
          image_data: postForm.imageData,
        },
      });
      toast.success("Forum post created.");
      setPostForm(initialPostForm);
      await loadPosts({ quiet: true });
      await loadFeaturedPosts({ quiet: true });
      await loadPost(response.data.post_id);
    } catch (error) {
      const message = authorityErrorMessage(error, apiErrorMessage(error, "Unable to create forum post."));
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function addReply(event) {
    event.preventDefault();
    if (!isLoggedIn || !address) {
      toast.error("Sign in to your wallet to reply.");
      return;
    }
    if (!selectedPostId || !replyForm.body.trim()) {
      toast.error("Enter a reply.");
      return;
    }
    if (!replyForm.password) {
      toast.error("Enter your wallet password to sign this reply locally.");
      return;
    }
    if (selectedPost?.moderation_status === "locked") {
      toast.error("This post is locked by moderation.");
      return;
    }

    setSubmitting(true);
    try {
      await postSignedAuthority({
        action: "forum.reply",
        walletPassword: replyForm.password,
        body: {
          post_id: selectedPostId,
          body: replyForm.body.trim(),
          image_data: replyForm.imageData,
        },
      });
      toast.success("Reply posted.");
      setReplyForm(initialReplyForm);
      await loadPost(selectedPostId);
      await loadPosts({ quiet: true });
      await loadFeaturedPosts({ quiet: true });
    } catch (error) {
      const message = authorityErrorMessage(error, apiErrorMessage(error, "Unable to post reply."));
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

  async function upvoteReply(replyId) {
    if (!selectedPostId || !replyId) return;
    const voter = (address || upvoteAddress).trim();
    if (!voter) {
      toast.error("Sign in or enter your wallet address before upvoting.");
      return;
    }
    try {
      await api.post("/forum/reply/upvote", {
        post_id: selectedPostId,
        reply_id: replyId,
        address: voter,
      });
      toast.success("Reply upvoted.");
      await loadPost(selectedPostId);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to upvote this reply.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function featurePost(postId) {
    if (!postId) return;
    if (!isLoggedIn || !address) {
      toast.error("Sign in to your wallet to feature a post.");
      return;
    }
    if (!featurePassword) {
      toast.error("Enter your wallet password to sign your feature vote locally.");
      return;
    }

    try {
      // Feature votes are signed (proving control) and the server requires the
      // voter to hold VLQ, so featuring can't be amplified with throwaway wallets.
      await postSignedAuthority({
        action: "forum.feature",
        walletPassword: featurePassword,
        body: { post_id: postId },
      });
      toast.success("Your feature vote was recorded.");
      setFeaturePassword("");
      if (selectedPostId === postId) {
        await loadPost(postId);
      }
      await loadPosts({ quiet: true });
      await loadFeaturedPosts({ quiet: true });
    } catch (error) {
      const message = authorityErrorMessage(error, apiErrorMessage(error, "Unable to record your feature vote."));
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

      <section className="card card-pad stack elev-2 feature-intro">
        <span className="eyebrow">New here?</span>
        <h2>The forum is where the community thinks out loud</h2>
        <p className="feature-intro-lead">
          This is Vorliq's public square — where members ask questions, share ideas, and shape where the
          project goes. You don't need to be an expert, and you don't need a big announcement: a good first
          post is simply a question or a hello.
        </p>
        <ul className="feature-intro-points">
          <li><strong>Not sure what to say?</strong> Introduce yourself, ask how something works, suggest something you'd like built, or share what you're working on.</li>
          <li><strong>Who will see it?</strong> Every member. Helpful posts get upvoted, and the community can feature the best ones at the top.</li>
          <li><strong>Why bother?</strong> This is how ideas turn into action — most governance proposals start life as a forum post, and posting is how people get to know you here.</li>
        </ul>
        <div className="button-row">
          {isLoggedIn ? (
            <a className="button" href="#create-post">Write your first post</a>
          ) : (
            <Link className="button" to="/login">Sign in to post</Link>
          )}
        </div>
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
            <p>Posting, replying, and featuring are signed locally with your wallet; authorship is verified and cannot be impersonated, and featuring also requires holding VLQ so it can't be inflated. Upvoting and reporting use public wallet addresses.</p>
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
                loadPosts({ offset: 0 });
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
          {isLoggedIn ? (
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              aria-label="Wallet password to sign feature votes"
              placeholder="Wallet password to feature posts"
              value={featurePassword}
              onChange={(event) => setFeaturePassword(event.target.value)}
            />
          ) : (
            <p className="help-text">
              <Link className="text-button" to="/login">Sign in</Link> to feature posts. Featuring is signed with your
              wallet and requires holding VLQ, so it can&apos;t be inflated with throwaway wallets.
            </p>
          )}
          {loadingPosts ? (
            <Spinner label="Loading forum posts..." />
          ) : displayedPosts.length === 0 ? (
            <div className="empty-state">
              {activeTab === "featured" ? (
                "No featured posts yet — when the community upvotes a great post, it can be featured here."
              ) : (
                <>
                  No posts yet — this space is waiting for its first voice.{" "}
                  {isLoggedIn ? (
                    <a className="text-button" href="#create-post">Start the first discussion</a>
                  ) : (
                    <Link className="text-button" to="/login">Sign in to start the first discussion</Link>
                  )}
                  {" "}— a question or a quick hello is a perfect first post.
                </>
              )}
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

          {activeTab === "all" && !searchQuery.trim() && totalPosts > 0 ? (
            <div className="forum-pagination">
              <span className="muted-text">
                {posts.length === 0
                  ? "No posts on this page."
                  : `Showing ${offset + 1} to ${offset + posts.length} of ${totalPosts} posts`}
              </span>
              <div className="button-row">
                <button
                  className="button secondary small-button"
                  type="button"
                  disabled={offset === 0 || loadingPosts}
                  onClick={() => loadPosts({ offset: Math.max(0, offset - PAGE_SIZE) })}
                >
                  Previous
                </button>
                <button
                  className="button secondary small-button"
                  type="button"
                  disabled={!hasMorePosts || loadingPosts}
                  onClick={() => loadPosts({ offset: offset + PAGE_SIZE })}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

          <div className="forum-create" id="create-post">
            <h2>Create a New Post</h2>
            {!isLoggedIn ? (
              <div className="risk-box">
                <Link className="text-button" to="/login">Sign in to your wallet</Link> to post. Authorship is signed
                locally so a post can only be published under the wallet that proves it controls the address.
              </div>
            ) : (
            <form className="form" onSubmit={createPost}>
              <div className="field">
                <label>Posting as</label>
                <span className="meta-value"><AddressIdentity address={address} compact /></span>
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
              <div className="field">
                <label htmlFor="forum-password">Wallet Password</label>
                <input
                  id="forum-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="To sign this post locally"
                  value={postForm.password}
                  onChange={(event) =>
                    setPostForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
                <small className="help-text">Your key is decrypted in this browser only to sign authorship. It is never sent.</small>
              </div>
              <button className="button" type="submit" disabled={submitting}>
                {submitting ? "Posting..." : "Post Message"}
              </button>
            </form>
            )}
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
                      <div className="button-row">
                        <button
                          className="button secondary small-button"
                          type="button"
                          onClick={() => upvoteReply(reply.reply_id)}
                        >
                          Upvote reply ({reply.vote_count || 0})
                        </button>
                        <ReportButton targetType="forum_reply" targetId={reply.reply_id} />
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No replies yet.</div>
                )}
              </section>

              {selectedPost.moderation_status === "locked" ? (
                <div className="empty-state">Replies are closed because this post is locked by moderation.</div>
              ) : !isLoggedIn ? (
                <div className="risk-box">
                  <Link className="text-button" to="/login">Sign in to your wallet</Link> to reply. Replies are signed
                  locally so authorship is verified.
                </div>
              ) : (
              <form className="form" onSubmit={addReply}>
                <h2>Reply</h2>
                <div className="field">
                  <label>Replying as</label>
                  <span className="meta-value"><AddressIdentity address={address} compact /></span>
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
                <div className="field">
                  <label htmlFor="reply-password">Wallet Password</label>
                  <input
                    id="reply-password"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    placeholder="To sign this reply locally"
                    value={replyForm.password}
                    onChange={(event) =>
                      setReplyForm((current) => ({ ...current, password: event.target.value }))
                    }
                  />
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
