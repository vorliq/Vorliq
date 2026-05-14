import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const initialPostForm = {
  authorAddress: "",
  title: "",
  body: "",
};

const initialReplyForm = {
  authorAddress: "",
  body: "",
};

function shortAddress(address) {
  if (!address) return "Unknown";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function formatTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

function Forum() {
  const [posts, setPosts] = useState([]);
  const [selectedPostId, setSelectedPostId] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);
  const [postForm, setPostForm] = useState(initialPostForm);
  const [replyForm, setReplyForm] = useState(initialReplyForm);
  const [upvoteAddress, setUpvoteAddress] = useState("");
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
  }, []);

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
        title: postForm.title.trim(),
        body: postForm.body.trim(),
      });
      toast.success("Forum post created.");
      setPostForm(initialPostForm);
      await loadPosts({ quiet: true });
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

    setSubmitting(true);
    try {
      await api.post("/forum/reply", {
        post_id: selectedPostId,
        author_address: replyForm.authorAddress.trim(),
        body: replyForm.body.trim(),
      });
      toast.success("Reply posted.");
      setReplyForm(initialReplyForm);
      await loadPost(selectedPostId);
      await loadPosts({ quiet: true });
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
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to upvote this post.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Community Discussion</span>
        <h1>Forum</h1>
        <p className="subtitle">
          Share ideas, ask questions, post community updates, and talk with other Vorliq members.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="two-column grid">
        <div className="card card-pad stack">
          <div className="section-title">
            <h2>Community Posts</h2>
            <button className="button secondary small-button" type="button" onClick={() => loadPosts()}>
              Refresh
            </button>
          </div>
          {loadingPosts ? (
            <Spinner label="Loading forum posts..." />
          ) : posts.length === 0 ? (
            <div className="empty-state">No forum posts yet. Start the first discussion.</div>
          ) : (
            <div className="forum-list">
              {posts.map((post) => (
                <button
                  className={`forum-card ${selectedPostId === post.post_id ? "active" : ""}`}
                  type="button"
                  key={post.post_id}
                  onClick={() => loadPost(post.post_id)}
                >
                  <strong>{post.title}</strong>
                  <span>By {shortAddress(post.author_address)}</span>
                  <span>
                    {post.vote_count} votes · {post.replies?.length || 0} replies
                  </span>
                  <small>{formatTime(post.timestamp)}</small>
                </button>
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
                  <h2>{selectedPost.title}</h2>
                </div>
              </div>
              <p>{selectedPost.body}</p>
              <div className="block-meta">
                <div className="meta-item">
                  <span className="meta-label">Author</span>
                  <span className="meta-value">{shortAddress(selectedPost.author_address)}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Votes</span>
                  <span className="meta-value">{selectedPost.vote_count}</span>
                </div>
              </div>
              <div className="inline-form">
                <input
                  className="input"
                  type="text"
                  placeholder="Wallet address for upvote"
                  value={upvoteAddress}
                  onChange={(event) => setUpvoteAddress(event.target.value)}
                />
                <button className="button" type="button" onClick={upvotePost}>
                  Upvote
                </button>
              </div>

              <section className="stack">
                <h2>Replies</h2>
                {selectedPost.replies?.length ? (
                  selectedPost.replies.map((reply) => (
                    <article className="reply-card" key={reply.reply_id}>
                      <p>{reply.body}</p>
                      <span>
                        {shortAddress(reply.author_address)} · {reply.vote_count} votes ·{" "}
                        {formatTime(reply.timestamp)}
                      </span>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No replies yet.</div>
                )}
              </section>

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
                <button className="button" type="submit" disabled={submitting}>
                  {submitting ? "Posting..." : "Post Reply"}
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">Select a post to read the full discussion.</div>
          )}
        </div>
      </section>
    </main>
  );
}

export default Forum;
